# --- Passwords (generated; kept in Secrets Manager and injected into tasks, never in env files) ---

resource "random_password" "db" {
  length  = 32
  special = false
}

resource "random_password" "search" {
  length           = 32
  min_upper        = 2
  min_lower        = 2
  min_numeric      = 2
  min_special      = 2
  override_special = "-_=+"
}

resource "aws_secretsmanager_secret" "db" {
  name_prefix = "${var.name}-db-"
}

resource "aws_secretsmanager_secret_version" "db" {
  secret_id     = aws_secretsmanager_secret.db.id
  secret_string = random_password.db.result
}

resource "aws_secretsmanager_secret" "search" {
  name_prefix = "${var.name}-search-"
}

resource "aws_secretsmanager_secret_version" "search" {
  secret_id     = aws_secretsmanager_secret.search.id
  secret_string = random_password.search.result
}

# --- Postgres (RDS) ------------------------------------------------------------------------------

resource "aws_db_subnet_group" "main" {
  name       = var.name
  subnet_ids = aws_subnet.private[*].id
}

resource "aws_db_parameter_group" "pg16" {
  name   = "${var.name}-pg16"
  family = "postgres16"
  # App copies x pool size (PGPOOL_MAX, 15) must stay under this; raise with the instance size.
  parameter {
    name         = "max_connections"
    value        = "400"
    apply_method = "pending-reboot"
  }
}

resource "aws_db_instance" "main" {
  identifier                = var.name
  engine                    = "postgres"
  engine_version            = "16"
  instance_class            = var.db_instance_class
  allocated_storage         = 50
  max_allocated_storage     = 200 # storage grows by itself
  storage_type              = "gp3"
  storage_encrypted         = true
  db_name                   = "sept11"
  username                  = "sept11"
  password                  = random_password.db.result
  db_subnet_group_name      = aws_db_subnet_group.main.name
  parameter_group_name      = aws_db_parameter_group.pg16.name
  vpc_security_group_ids    = [aws_security_group.data.id]
  multi_az                  = var.db_multi_az
  backup_retention_period   = 7
  apply_immediately         = true
  skip_final_snapshot       = false
  final_snapshot_identifier = "${var.name}-final"
  deletion_protection       = true
}

resource "aws_db_instance" "replica" {
  count                  = var.db_read_replica ? 1 : 0
  identifier             = "${var.name}-replica"
  replicate_source_db    = aws_db_instance.main.identifier
  instance_class         = var.db_instance_class
  storage_type           = "gp3"
  storage_encrypted      = true
  parameter_group_name   = aws_db_parameter_group.pg16.name
  vpc_security_group_ids = [aws_security_group.data.id]
  apply_immediately      = true
  skip_final_snapshot    = true
}

# --- Search (Amazon OpenSearch Service) ----------------------------------------------------------

resource "aws_opensearch_domain" "main" {
  domain_name    = var.name
  engine_version = "OpenSearch_2.19"

  cluster_config {
    instance_type          = var.search_instance_type
    instance_count         = var.search_instance_count
    zone_awareness_enabled = var.search_instance_count > 1
    dynamic "zone_awareness_config" {
      for_each = var.search_instance_count > 1 ? [1] : []
      content { availability_zone_count = 2 }
    }
  }

  ebs_options {
    ebs_enabled = true
    volume_type = "gp3"
    volume_size = var.search_volume_gb
  }

  vpc_options {
    subnet_ids         = var.search_instance_count > 1 ? aws_subnet.private[*].id : [aws_subnet.private[0].id]
    security_group_ids = [aws_security_group.data.id]
  }

  # Basic auth via fine-grained access control (OPENSEARCH_USER / OPENSEARCH_PASSWORD), which the
  # app and the pipeline both speak; reachable only from inside the VPC.
  advanced_security_options {
    enabled                        = true
    internal_user_database_enabled = true
    master_user_options {
      master_user_name     = "records"
      master_user_password = random_password.search.result
    }
  }
  encrypt_at_rest { enabled = true }
  node_to_node_encryption { enabled = true }
  domain_endpoint_options {
    enforce_https       = true
    tls_security_policy = "Policy-Min-TLS-1-2-2019-07"
  }

  access_policies = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect    = "Allow"
      Principal = { AWS = "*" }
      Action    = "es:ESHttp*"
      Resource  = "arn:aws:es:${var.region}:${data.aws_caller_identity.me.account_id}:domain/${var.name}/*"
    }]
  })
}

# --- Files: S3 behind CloudFront -----------------------------------------------------------------
# pdf/, page/, text/ are public through CloudFront (the documents are public records; the app
# redirects /files/* there). downloads/ (the ZIPs) is NOT: the app hands out presigned links to it
# after its captcha check. The bucket itself is private.

resource "aws_s3_bucket" "files" {
  bucket = local.bucket_name
}

resource "aws_s3_bucket_public_access_block" "files" {
  bucket                  = aws_s3_bucket.files.id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_ownership_controls" "files" {
  bucket = aws_s3_bucket.files.id
  rule { object_ownership = "BucketOwnerEnforced" }
}

resource "aws_cloudfront_origin_access_control" "files" {
  name                              = "${var.name}-files"
  origin_access_control_origin_type = "s3"
  signing_behavior                  = "always"
  signing_protocol                  = "sigv4"
}

data "aws_cloudfront_cache_policy" "optimized" {
  name = "Managed-CachingOptimized"
}

resource "aws_cloudfront_distribution" "files" {
  enabled     = true
  comment     = "${var.name} documents"
  price_class = "PriceClass_100"

  origin {
    origin_id                = "files"
    domain_name              = aws_s3_bucket.files.bucket_regional_domain_name
    origin_access_control_id = aws_cloudfront_origin_access_control.files.id
  }

  default_cache_behavior {
    target_origin_id       = "files"
    viewer_protocol_policy = "redirect-to-https"
    allowed_methods        = ["GET", "HEAD"]
    cached_methods         = ["GET", "HEAD"]
    cache_policy_id        = data.aws_cloudfront_cache_policy.optimized.id
    compress               = false # PDFs and WebP are already compressed
  }

  restrictions {
    geo_restriction { restriction_type = "none" }
  }

  viewer_certificate {
    cloudfront_default_certificate = true
  }
}

resource "aws_s3_bucket_policy" "files" {
  bucket = aws_s3_bucket.files.id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Sid       = "CloudFrontReadsDocumentsOnly"
      Effect    = "Allow"
      Principal = { Service = "cloudfront.amazonaws.com" }
      Action    = "s3:GetObject"
      Resource  = [for p in ["pdf", "page", "text"] : "${aws_s3_bucket.files.arn}/${p}/*"]
      Condition = { StringEquals = { "AWS:SourceArn" = aws_cloudfront_distribution.files.arn } }
    }]
  })
  depends_on = [aws_s3_bucket_public_access_block.files]
}

# --- EFS: the seed task's working copy of data/ (remembers what it already fetched) -------------

resource "aws_efs_file_system" "seed" {
  encrypted       = true
  throughput_mode = "elastic"
  lifecycle_policy { transition_to_ia = "AFTER_7_DAYS" }
  tags = { Name = "${var.name}-seed" }
}

resource "aws_efs_mount_target" "seed" {
  count           = 2
  file_system_id  = aws_efs_file_system.seed.id
  subnet_id       = aws_subnet.private[count.index].id
  security_groups = [aws_security_group.data.id]
}
