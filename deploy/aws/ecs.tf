locals {
  ready        = var.app_image != "" && var.pipeline_image != ""
  embed_url    = "http://embed.${var.name}.internal:11434"
  files_url    = "https://${aws_cloudfront_distribution.files.domain_name}"
  search_url   = "https://${aws_opensearch_domain.main.endpoint}"
  pg_host      = aws_db_instance.main.address
  database_url = "postgres://sept11@${local.pg_host}:5432/sept11?sslmode=no-verify"
  replica_url  = var.db_read_replica ? "postgres://sept11@${aws_db_instance.replica[0].address}:5432/sept11?sslmode=no-verify" : ""

  app_env = merge({
    NODE_OPTIONS       = "--max-old-space-size=${floor(var.app_memory * 0.75)}"
    AWS_REGION         = var.region
    REPLICA_NAME       = "ecs"
    DATABASE_URL       = local.database_url # password from PGPASSWORD (secret)
    DATABASE_READ_URL  = local.replica_url
    OPENSEARCH_URL     = local.search_url
    OPENSEARCH_USER    = "records"
    FILES_URL          = local.files_url # server-side reads (word boxes, health)
    FILES_PUBLIC_URL   = local.files_url # readers are redirected here for PDFs and page images
    DOWNLOADS_S3       = var.build_downloads ? "s3://${aws_s3_bucket.files.bucket}/downloads" : ""
    RATE_LIMIT_STORE   = "postgres" # one limit across all app copies
    EMBED_PROVIDER     = "ollama"
    EMBED_URL          = local.embed_url
    EMBED_QUERY_PREFIX = "search_query: "
  }, var.app_env)

  app_secrets = merge({
    PGPASSWORD          = aws_secretsmanager_secret.db.arn
    OPENSEARCH_PASSWORD = aws_secretsmanager_secret.search.arn
  }, var.app_secrets)
}

# --- Registries (the first apply creates these; deploy/aws/build-push.sh fills them) ------------

resource "aws_ecr_repository" "app" {
  name         = "${var.name}/app"
  force_delete = true
}

resource "aws_ecr_repository" "pipeline" {
  name         = "${var.name}/pipeline"
  force_delete = true
}

# --- Cluster, logs, service discovery ----------------------------------------------------------

resource "aws_ecs_cluster" "main" {
  name = var.name
  setting {
    name  = "containerInsights"
    value = "enabled"
  }
}

resource "aws_cloudwatch_log_group" "main" {
  name              = "/ecs/${var.name}"
  retention_in_days = 30
}

resource "aws_service_discovery_private_dns_namespace" "main" {
  name = "${var.name}.internal"
  vpc  = aws_vpc.main.id
}

resource "aws_service_discovery_service" "embed" {
  name = "embed"
  dns_config {
    namespace_id   = aws_service_discovery_private_dns_namespace.main.id
    routing_policy = "MULTIVALUE"
    dns_records {
      type = "A"
      ttl  = 10
    }
  }
  health_check_custom_config {}
}

# --- Load balancer ---------------------------------------------------------------------------

resource "aws_lb" "main" {
  name               = var.name
  load_balancer_type = "application"
  security_groups    = [aws_security_group.alb.id]
  subnets            = aws_subnet.public[*].id
  idle_timeout       = 120 # Ask answers can take a while
}

resource "aws_lb_target_group" "app" {
  name                 = "${var.name}-app"
  port                 = 3000
  protocol             = "HTTP"
  target_type          = "ip"
  vpc_id               = aws_vpc.main.id
  deregistration_delay = 30
  health_check {
    path                = "/api/health"
    matcher             = "200"
    interval            = 15
    healthy_threshold   = 2
    unhealthy_threshold = 3
  }
}

resource "aws_lb_listener" "http" {
  load_balancer_arn = aws_lb.main.arn
  port              = 80
  protocol          = "HTTP"
  default_action {
    type             = var.certificate_arn == "" ? "forward" : "redirect"
    target_group_arn = var.certificate_arn == "" ? aws_lb_target_group.app.arn : null
    dynamic "redirect" {
      for_each = var.certificate_arn == "" ? [] : [1]
      content {
        port        = "443"
        protocol    = "HTTPS"
        status_code = "HTTP_301"
      }
    }
  }
}

resource "aws_lb_listener" "https" {
  count             = var.certificate_arn == "" ? 0 : 1
  load_balancer_arn = aws_lb.main.arn
  port              = 443
  protocol          = "HTTPS"
  ssl_policy        = "ELBSecurityPolicy-TLS13-1-2-2021-06"
  certificate_arn   = var.certificate_arn
  default_action {
    type             = "forward"
    target_group_arn = aws_lb_target_group.app.arn
  }
}

# --- App -------------------------------------------------------------------------------------

resource "aws_ecs_task_definition" "app" {
  count                    = local.ready ? 1 : 0
  family                   = "${var.name}-app"
  requires_compatibilities = ["FARGATE"]
  network_mode             = "awsvpc"
  cpu                      = var.app_cpu
  memory                   = var.app_memory
  execution_role_arn       = aws_iam_role.execution.arn
  task_role_arn            = aws_iam_role.app.arn
  runtime_platform {
    cpu_architecture        = "ARM64"
    operating_system_family = "LINUX"
  }
  container_definitions = jsonencode([{
    name         = "app"
    image        = var.app_image
    essential    = true
    portMappings = [{ containerPort = 3000 }]
    environment  = [for k, v in local.app_env : { name = k, value = v }]
    secrets      = [for k, v in local.app_secrets : { name = k, valueFrom = v }]
    logConfiguration = {
      logDriver = "awslogs"
      options = {
        awslogs-group         = aws_cloudwatch_log_group.main.name
        awslogs-region        = var.region
        awslogs-stream-prefix = "app"
      }
    }
  }])
}

resource "aws_ecs_service" "app" {
  count                             = local.ready ? 1 : 0
  name                              = "app"
  cluster                           = aws_ecs_cluster.main.id
  task_definition                   = aws_ecs_task_definition.app[0].arn
  desired_count                     = var.app_min_count
  launch_type                       = "FARGATE"
  health_check_grace_period_seconds = 60
  network_configuration {
    subnets          = aws_subnet.public[*].id
    security_groups  = [aws_security_group.tasks.id]
    assign_public_ip = true
  }
  load_balancer {
    target_group_arn = aws_lb_target_group.app.arn
    container_name   = "app"
    container_port   = 3000
  }
  deployment_circuit_breaker {
    enable   = true
    rollback = true
  }
  lifecycle { ignore_changes = [desired_count] } # autoscaling owns it
  depends_on = [aws_lb_listener.http]
}

resource "aws_appautoscaling_target" "app" {
  count              = local.ready ? 1 : 0
  service_namespace  = "ecs"
  resource_id        = "service/${aws_ecs_cluster.main.name}/${aws_ecs_service.app[0].name}"
  scalable_dimension = "ecs:service:DesiredCount"
  min_capacity       = var.app_min_count
  max_capacity       = var.app_max_count
}

resource "aws_appautoscaling_policy" "app_cpu" {
  count              = local.ready ? 1 : 0
  name               = "${var.name}-app-cpu"
  policy_type        = "TargetTrackingScaling"
  service_namespace  = aws_appautoscaling_target.app[0].service_namespace
  resource_id        = aws_appautoscaling_target.app[0].resource_id
  scalable_dimension = aws_appautoscaling_target.app[0].scalable_dimension
  target_tracking_scaling_policy_configuration {
    target_value       = var.app_cpu_target
    scale_in_cooldown  = 300
    scale_out_cooldown = 60
    predefined_metric_specification {
      predefined_metric_type = "ECSServiceAverageCPUUtilization"
    }
  }
}

# --- Query embeddings (Ollama + nomic-embed-text, pulled on each task start) -------------------

resource "aws_ecs_task_definition" "embed" {
  family                   = "${var.name}-embed"
  requires_compatibilities = ["FARGATE"]
  network_mode             = "awsvpc"
  cpu                      = 1024
  memory                   = 2048
  execution_role_arn       = aws_iam_role.execution.arn
  runtime_platform {
    cpu_architecture        = "ARM64"
    operating_system_family = "LINUX"
  }
  container_definitions = jsonencode([{
    name         = "embed"
    image        = "ollama/ollama:latest"
    essential    = true
    portMappings = [{ containerPort = 11434 }]
    entryPoint   = ["/bin/sh", "-c"]
    command      = ["ollama serve & until ollama list >/dev/null 2>&1; do sleep 1; done; ollama pull nomic-embed-text && wait"]
    healthCheck = {
      command     = ["CMD-SHELL", "ollama list | grep -q nomic-embed-text"]
      interval    = 15
      retries     = 3
      startPeriod = 120
    }
    logConfiguration = {
      logDriver = "awslogs"
      options = {
        awslogs-group         = aws_cloudwatch_log_group.main.name
        awslogs-region        = var.region
        awslogs-stream-prefix = "embed"
      }
    }
  }])
}

resource "aws_ecs_service" "embed" {
  name            = "embed"
  cluster         = aws_ecs_cluster.main.id
  task_definition = aws_ecs_task_definition.embed.arn
  desired_count   = var.embed_min_count
  launch_type     = "FARGATE"
  network_configuration {
    subnets          = aws_subnet.public[*].id
    security_groups  = [aws_security_group.tasks.id]
    assign_public_ip = true # pulls the model from ollama.com
  }
  service_registries {
    registry_arn = aws_service_discovery_service.embed.arn
  }
  lifecycle { ignore_changes = [desired_count] }
}

resource "aws_appautoscaling_target" "embed" {
  service_namespace  = "ecs"
  resource_id        = "service/${aws_ecs_cluster.main.name}/${aws_ecs_service.embed.name}"
  scalable_dimension = "ecs:service:DesiredCount"
  min_capacity       = var.embed_min_count
  max_capacity       = var.embed_max_count
}

resource "aws_appautoscaling_policy" "embed_cpu" {
  name               = "${var.name}-embed-cpu"
  policy_type        = "TargetTrackingScaling"
  service_namespace  = aws_appautoscaling_target.embed.service_namespace
  resource_id        = aws_appautoscaling_target.embed.resource_id
  scalable_dimension = aws_appautoscaling_target.embed.scalable_dimension
  target_tracking_scaling_policy_configuration {
    target_value       = 60
    scale_in_cooldown  = 300
    scale_out_cooldown = 60
    predefined_metric_specification {
      predefined_metric_type = "ECSServiceAverageCPUUtilization"
    }
  }
}

# --- Seed task: fetch the documents, load RDS + OpenSearch, copy files to S3 --------------------
# Run once after the first apply (the `seed_first_run` output prints the command), then daily on
# seed_schedule to pick up seed updates. data/ lives on EFS so each run only does new work.

resource "aws_ecs_task_definition" "seed" {
  count                    = local.ready ? 1 : 0
  family                   = "${var.name}-seed"
  requires_compatibilities = ["FARGATE"]
  network_mode             = "awsvpc"
  cpu                      = 4096
  memory                   = 16384
  execution_role_arn       = aws_iam_role.execution.arn
  task_role_arn            = aws_iam_role.seed.arn
  ephemeral_storage { size_in_gib = 50 }
  runtime_platform {
    cpu_architecture        = "ARM64"
    operating_system_family = "LINUX"
  }
  volume {
    name = "data"
    efs_volume_configuration {
      file_system_id     = aws_efs_file_system.seed.id
      transit_encryption = "ENABLED"
    }
  }
  container_definitions = jsonencode([{
    name        = "seed"
    image       = var.pipeline_image
    essential   = true
    command     = ["scripts/seed/sync_seed.sh"]
    mountPoints = [{ sourceVolume = "data", containerPath = "/repo/data" }]
    environment = [for k, v in {
      PYTHON               = "python3"
      AWS_REGION           = var.region
      PGHOST               = local.pg_host
      PGPORT               = "5432"
      PGUSER               = "sept11"
      PGDATABASE           = "sept11"
      PGSSLMODE            = "require"
      OPENSEARCH_URL       = local.search_url
      OPENSEARCH_USER      = "records"
      SEED_URL             = var.seed_url
      SEED_EXIT_WHEN_DONE  = "1"
      FILES_S3             = "s3://${aws_s3_bucket.files.bucket}"
      FILES_S3_PRUNE_LOCAL = "0" # keep PDFs on EFS so ZIP downloads can be rebuilt
      BUILD_DOWNLOADS      = var.build_downloads ? "1" : "0"
      EMBED_PROVIDER       = "ollama"
      EMBED_URL            = local.embed_url
    } : { name = k, value = v }]
    secrets = [
      { name = "PGPASSWORD", valueFrom = aws_secretsmanager_secret.db.arn },
      { name = "OPENSEARCH_PASSWORD", valueFrom = aws_secretsmanager_secret.search.arn },
    ]
    logConfiguration = {
      logDriver = "awslogs"
      options = {
        awslogs-group         = aws_cloudwatch_log_group.main.name
        awslogs-region        = var.region
        awslogs-stream-prefix = "seed"
      }
    }
  }])
}

resource "aws_scheduler_schedule" "seed" {
  count               = local.ready && var.seed_schedule != "" ? 1 : 0
  name                = "${var.name}-seed"
  schedule_expression = var.seed_schedule
  flexible_time_window { mode = "OFF" }
  target {
    arn      = aws_ecs_cluster.main.arn
    role_arn = aws_iam_role.scheduler.arn
    ecs_parameters {
      task_definition_arn = aws_ecs_task_definition.seed[0].arn
      launch_type         = "FARGATE"
      network_configuration {
        subnets          = aws_subnet.public[*].id
        security_groups  = [aws_security_group.tasks.id]
        assign_public_ip = true
      }
    }
  }
}
