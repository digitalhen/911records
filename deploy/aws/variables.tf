variable "region" {
  type    = string
  default = "us-east-1"
}

variable "name" {
  description = "Prefix for every resource (lowercase letters, digits, hyphens)."
  type        = string
  default     = "records"
}

# --- The documents ---------------------------------------------------------------------------

variable "seed_url" {
  description = "Where the seed task fetches the documents: the Google Drive folder link, s3://bucket/prefix or https://... (scripts/seed/fetch_seed.py)."
  type        = string
}

variable "seed_bucket_arn" {
  description = "If seed_url is s3://, the ARN of that bucket, so the seed task may read it. Empty otherwise."
  type        = string
  default     = ""
}

variable "seed_schedule" {
  description = "When the seed task re-runs to pick up seed updates (EventBridge Scheduler expression). Empty disables the schedule."
  type        = string
  default     = "cron(0 9 * * ? *)" # daily 09:00 UTC
}

variable "build_downloads" {
  description = "Build the per-box ZIP downloads (about 40 GB more in S3 and on EFS)."
  type        = bool
  default     = true
}

# --- App -------------------------------------------------------------------------------------

variable "app_image" {
  description = "App image URI (deploy/aws/build-push.sh prints it). Leave empty on the first apply, which only creates the registries; then build, push and apply again."
  type        = string
  default     = ""
}

variable "pipeline_image" {
  description = "Pipeline/seed image URI (deploy/aws/build-push.sh prints it)."
  type        = string
  default     = ""
}

variable "certificate_arn" {
  description = "ACM certificate for HTTPS on the load balancer. Empty = HTTP only (testing)."
  type        = string
  default     = ""
}

variable "app_cpu" {
  type    = number
  default = 1024
}

variable "app_memory" {
  type    = number
  default = 2048
}

variable "app_min_count" {
  type    = number
  default = 2
}

variable "app_max_count" {
  type    = number
  default = 10
}

variable "app_cpu_target" {
  description = "Average CPU % the app service scales to hold."
  type        = number
  default     = 60
}

variable "embed_min_count" {
  type    = number
  default = 1
}

variable "embed_max_count" {
  type    = number
  default = 4
}

variable "app_env" {
  description = "Extra app environment: Ask (LLM_PROVIDER, ASK_MODEL, ...), TURNSTILE_*, DOWNLOAD_SESSION_SECRET, etc. (docs/MODELS.md, deploy/.env.example)."
  type        = map(string)
  default     = {}
}

variable "app_secrets" {
  description = "Extra app secrets as ENV_NAME => Secrets Manager/SSM ARN (e.g. ANTHROPIC_API_KEY, TURNSTILE_SECRET_KEY)."
  type        = map(string)
  default     = {}
}

variable "bedrock_model_arns" {
  description = "Bedrock model/inference-profile ARNs the app may invoke for Ask (LLM_PROVIDER=bedrock). Empty = no Bedrock access."
  type        = list(string)
  default     = []
}

# --- Databases -------------------------------------------------------------------------------

variable "db_instance_class" {
  type    = string
  default = "db.t4g.medium"
}

variable "db_multi_az" {
  type    = bool
  default = false
}

variable "db_read_replica" {
  description = "Add an RDS read replica; the app sends reads there (DATABASE_READ_URL) and falls back to the primary."
  type        = bool
  default     = false
}

variable "search_instance_type" {
  type    = string
  default = "r6g.large.search"
}

variable "search_instance_count" {
  description = "OpenSearch data nodes. 2 or more spreads them over two availability zones."
  type        = number
  default     = 1
}

variable "search_volume_gb" {
  type    = number
  default = 50
}
