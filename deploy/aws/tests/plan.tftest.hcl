# Plans the stack against mocked AWS (no account needed): terraform init && terraform test
mock_provider "aws" {
  mock_resource "aws_iam_role" {
    defaults = { arn = "arn:aws:iam::123456789012:role/mock" }
  }
  mock_resource "aws_secretsmanager_secret" {
    defaults = { arn = "arn:aws:secretsmanager:us-east-1:123456789012:secret:mock" }
  }
  mock_resource "aws_s3_bucket" {
    defaults = { arn = "arn:aws:s3:::records-files-123456789012" }
  }
  mock_resource "aws_ecs_cluster" {
    defaults = { arn = "arn:aws:ecs:us-east-1:123456789012:cluster/records" }
  }
  mock_resource "aws_cloudfront_distribution" {
    defaults = { arn = "arn:aws:cloudfront::123456789012:distribution/MOCK" }
  }
  mock_resource "aws_efs_file_system" {
    defaults = { arn = "arn:aws:elasticfilesystem:us-east-1:123456789012:file-system/fs-mock" }
  }
  mock_resource "aws_service_discovery_service" {
    defaults = { arn = "arn:aws:servicediscovery:us-east-1:123456789012:service/srv-mock" }
  }
  mock_resource "aws_lb_target_group" {
    defaults = { arn = "arn:aws:elasticloadbalancing:us-east-1:123456789012:targetgroup/records/mock" }
  }
  mock_resource "aws_lb" {
    defaults = { arn = "arn:aws:elasticloadbalancing:us-east-1:123456789012:loadbalancer/app/records/mock" }
  }
  mock_resource "aws_lb_listener" {
    defaults = { arn = "arn:aws:elasticloadbalancing:us-east-1:123456789012:listener/app/records/mock/l" }
  }
  mock_resource "aws_ecs_task_definition" {
    defaults = { arn = "arn:aws:ecs:us-east-1:123456789012:task-definition/records:1", family = "records-seed" }
  }
  override_data {
    target = data.aws_availability_zones.available
    values = { names = ["us-east-1a", "us-east-1b", "us-east-1c"] }
  }
  override_data {
    target = data.aws_caller_identity.me
    values = { account_id = "123456789012" }
  }
  override_data {
    target = data.aws_cloudfront_cache_policy.optimized
    values = { id = "658327ea-f89d-4fab-a63d-7e88639e58f6" }
  }
  override_data {
    target = data.aws_iam_policy_document.ecs_tasks_assume
    values = { json = "{\"Version\":\"2012-10-17\",\"Statement\":[{\"Effect\":\"Allow\",\"Action\":\"sts:AssumeRole\",\"Principal\":{\"Service\":\"ecs-tasks.amazonaws.com\"}}]}" }
  }
}
mock_provider "random" {}

variables {
  seed_url = "https://drive.google.com/drive/folders/abc"
}

run "first_apply_creates_registries_and_data_only" {
  command = plan
  assert {
    condition     = length(aws_ecs_service.app) == 0 && length(aws_ecs_task_definition.seed) == 0
    error_message = "app and seed must wait for images"
  }
  assert {
    condition     = aws_s3_bucket.files.bucket == "records-files-123456789012"
    error_message = "bucket name"
  }
}

run "scaled_deploy" {
  command = apply # mocked: nothing reaches AWS
  variables {
    app_image             = "123456789012.dkr.ecr.us-east-1.amazonaws.com/records/app:t"
    pipeline_image        = "123456789012.dkr.ecr.us-east-1.amazonaws.com/records/pipeline:t"
    certificate_arn       = "arn:aws:acm:us-east-1:123456789012:certificate/x"
    db_read_replica       = true
    db_multi_az           = true
    search_instance_count = 2
    app_max_count         = 20
    seed_bucket_arn       = "arn:aws:s3:::seed"
    seed_url              = "s3://seed/911records-seed"
    bedrock_model_arns    = ["arn:aws:bedrock:*::foundation-model/anthropic.claude-haiku-4-5-20251001-v1:0"]
    app_env               = { LLM_PROVIDER = "bedrock" }
    app_secrets           = { TURNSTILE_SECRET_KEY = "arn:aws:ssm:us-east-1:123456789012:parameter/ts" }
  }
  assert {
    condition     = aws_appautoscaling_target.app[0].max_capacity == 20 && aws_appautoscaling_target.app[0].min_capacity == 2
    error_message = "app autoscaling bounds"
  }
  assert {
    condition     = length(aws_lb_listener.https) == 1 && length(aws_db_instance.replica) == 1
    error_message = "https listener and read replica"
  }
  assert {
    condition     = aws_opensearch_domain.main.cluster_config[0].zone_awareness_enabled
    error_message = "two-node search spans two zones"
  }
  assert {
    condition     = strcontains(aws_ecs_task_definition.app[0].container_definitions, "RATE_LIMIT_STORE") && strcontains(aws_ecs_task_definition.app[0].container_definitions, "FILES_PUBLIC_URL") && strcontains(aws_ecs_task_definition.app[0].container_definitions, "DATABASE_READ_URL")
    error_message = "app env wiring"
  }
  assert {
    condition     = length(aws_scheduler_schedule.seed) == 1
    error_message = "daily seed schedule"
  }
}
