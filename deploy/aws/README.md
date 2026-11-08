# Scalable AWS deployment (Terraform)

The whole stack on managed AWS services, with the app autoscaling:

```
            readers ──► ALB ──► app (ECS Fargate, 2..N copies, autoscaled on CPU) ──► RDS Postgres 16 (+ optional read replica)
               │                  │                                               └► OpenSearch Service (1-N nodes)
               │                  └► embed (Ollama + nomic-embed-text, ECS, autoscaled)
               └──► CloudFront ──► S3 (PDFs, page images, text)   ◄── seed task (ECS, daily) ◄── the seed (Drive or S3)
                                   S3 downloads/ (ZIPs, presigned links only)                   └► loads RDS + OpenSearch
```

- **Files never pass through the app.** `/files/*` answers with a redirect to CloudFront
  (`FILES_PUBLIC_URL`), and ZIP downloads with a 15-minute presigned S3 link after the captcha
  check (`DOWNLOADS_S3`). App copies only render pages and answer Ask, so they stay small.
- **Limits hold across copies.** Per-visitor rate limits are counted in Postgres
  (`RATE_LIMIT_STORE=postgres`), and Ask's daily spending cap already was, so 20 copies enforce
  the same limits as one.
- **Nothing to load by hand.** The seed task fetches the documents, creates the database role,
  loads RDS and OpenSearch, copies files to S3 and builds the ZIPs, then re-runs daily to pick up
  seed updates (only new work each time).
- **Secrets** (database and search passwords) are generated and kept in Secrets Manager.

## What scales, and how

| Piece | Scales | Notes |
|---|---|---|
| App | automatically, `app_min_count`..`app_max_count` (2..10), holding `app_cpu_target` (60%) CPU | stateless; each copy keeps a pool of up to 15 Postgres connections, `max_connections` is 400 |
| Query embeddings | automatically, `embed_min_count`..`embed_max_count` (1..4) | each copy pulls the 270 MB model on start |
| Documents | automatically (CloudFront + S3) | |
| Postgres | storage automatically (50 → 200 GB); compute by changing `db_instance_class`; reads via `db_read_replica` | the app falls back to the primary if the replica lags or fails |
| Search | by changing `search_instance_type` / `search_instance_count` (2+ spreads over two zones) | changes are blue/green, no downtime |

## Cost (us-east-1, on-demand, rough, per month)

Baseline (defaults): 2 app copies ~$60, 1 embed ~$30, RDS `db.t4g.medium` ~$60,
OpenSearch 1 × `r6g.large` ~$130, ALB ~$20, S3 ~70-110 GB + CloudFront ~$5 plus traffic,
EFS (seed working copy, mostly infrequent-access) ~$5, logs ~$5: **about $315**, plus Ask model
usage and data transfer out (CloudFront ~$0.085/GB). The seed task costs ~$0.25/hour while it
runs (hours on the first run, minutes afterwards). High availability (`db_multi_az`,
`search_instance_count = 2`) adds about $190.

## Deploy

Needs: an AWS account, [Terraform](https://developer.hashicorp.com/terraform/install) 1.6+,
the AWS CLI (`aws configure` or SSO), Docker with buildx, and the seed link from the 911records
maintainer (or your own S3 copy of the seed: docs/SELF-HOSTING.md section 2).

```sh
cd deploy/aws
cp terraform.tfvars.example terraform.tfvars    # set seed_url (and region, name)
cp build.env.example build.env                  # your site URL, operator name, contact email

terraform init
terraform apply          # 1. network, databases, S3/CloudFront, registries (~20 min, mostly OpenSearch)

./build-push.sh          # 2. build the app and pipeline images for ARM64 and push them to ECR
                         #    paste the two printed lines into terraform.tfvars
terraform apply          # 3. app, embeddings, seed task, autoscaling, daily schedule

terraform output -raw seed_first_run | sh   # 4. load the documents (first run: a few hours)
$(terraform output -raw logs)               #    follow progress (stream prefix seed/)
```

5. **Domain and HTTPS.** Request an ACM certificate for your domain in the same region
   (DNS validation), set `certificate_arn` in `terraform.tfvars`, `terraform apply`, then point
   the domain at `terraform output site_url` (CNAME, or a Route 53 alias). `SITE_URL` in
   `build.env` must be that domain.

The site answers as soon as step 3 finishes, with search and pages filling in as the first seed
run loads (the health check at `/api/health` shows the counts). The load balancer's health
check uses `/api/health`.

**Ask (optional).** Bedrock: enable the Claude model in the Bedrock console, then set `app_env`
(`LLM_PROVIDER = "bedrock"`, `ASK_MODEL`) and `bedrock_model_arns` in `terraform.tfvars`. Other
providers: put the key in Secrets Manager and pass it via `app_secrets`
(e.g. `{ ANTHROPIC_API_KEY = "arn:aws:secretsmanager:..." }`). docs/MODELS.md has the options.

## Updating

- **New code:** `./build-push.sh`, paste the new tags, `terraform apply`. ECS rolls the app over
  with no downtime and rolls back by itself if the new copies fail their health check.
- **New documents:** automatic (the daily seed task). Run it by hand with the `seed_first_run`
  command.
- **More capacity:** change the variables above and `terraform apply`.

## Notes and limits

- Tested: `terraform validate` and `terraform test` (plans and applies against mocked AWS:
  `terraform init && terraform test`). It has not yet been applied to a real AWS account, so the
  first real deployment may need small fixes. Report them, please.
- ECS tasks run in public subnets with public IPs (outbound to Google Drive, ECR, Bedrock and
  ollama.com) behind a security group that admits only the load balancer, which avoids a NAT
  gateway (~$35/month). RDS, OpenSearch and EFS sit in private subnets with no internet access.
- Terraform state is local (`terraform.tfstate`, gitignored, contains the generated passwords).
  For a team, move it to an S3 backend.
- The RDS instance has deletion protection and takes a final snapshot. To tear everything down,
  set `deletion_protection = false` in `data.tf`, apply, then `terraform destroy`; empty the S3
  bucket first.
