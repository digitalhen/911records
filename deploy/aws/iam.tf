data "aws_iam_policy_document" "ecs_tasks_assume" {
  statement {
    actions = ["sts:AssumeRole"]
    principals {
      type        = "Service"
      identifiers = ["ecs-tasks.amazonaws.com"]
    }
  }
}

# --- Execution role: pull images, write logs, read the secrets injected into containers --------

resource "aws_iam_role" "execution" {
  name               = "${var.name}-execution"
  assume_role_policy = data.aws_iam_policy_document.ecs_tasks_assume.json
}

resource "aws_iam_role_policy_attachment" "execution" {
  role       = aws_iam_role.execution.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AmazonECSTaskExecutionRolePolicy"
}

locals {
  ssm_secret_arns = [for arn in values(var.app_secrets) : arn if startswith(arn, "arn:aws:ssm:")]
}

resource "aws_iam_role_policy" "execution_secrets" {
  name = "secrets"
  role = aws_iam_role.execution.id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = concat(
      [{
        Effect = "Allow"
        Action = ["secretsmanager:GetSecretValue"]
        Resource = concat(
          [aws_secretsmanager_secret.db.arn, aws_secretsmanager_secret.search.arn],
          [for arn in values(var.app_secrets) : arn if startswith(arn, "arn:aws:secretsmanager:")],
        )
      }],
      length(local.ssm_secret_arns) == 0 ? [] : [{
        Effect   = "Allow"
        Action   = ["ssm:GetParameters"]
        Resource = local.ssm_secret_arns
      }],
    )
  })
}

# --- App: presign archive downloads; Bedrock for Ask (optional) --------------------------------

resource "aws_iam_role" "app" {
  name               = "${var.name}-app"
  assume_role_policy = data.aws_iam_policy_document.ecs_tasks_assume.json
}

resource "aws_iam_role_policy" "app" {
  name = "app"
  role = aws_iam_role.app.id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = concat(
      [{
        Effect   = "Allow"
        Action   = ["s3:GetObject"]
        Resource = ["${aws_s3_bucket.files.arn}/downloads/*"]
      }],
      length(var.bedrock_model_arns) == 0 ? [] : [{
        Effect   = "Allow"
        Action   = ["bedrock:InvokeModel", "bedrock:InvokeModelWithResponseStream"]
        Resource = var.bedrock_model_arns
      }],
    )
  })
}

# --- Seed task: read the seed (if in S3), write the files bucket, mount EFS ---------------------

resource "aws_iam_role" "seed" {
  name               = "${var.name}-seed"
  assume_role_policy = data.aws_iam_policy_document.ecs_tasks_assume.json
}

resource "aws_iam_role_policy" "seed" {
  name = "seed"
  role = aws_iam_role.seed.id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = concat(
      [
        {
          Effect   = "Allow"
          Action   = ["s3:ListBucket"]
          Resource = [aws_s3_bucket.files.arn]
        },
        {
          Effect   = "Allow"
          Action   = ["s3:GetObject", "s3:PutObject", "s3:DeleteObject"]
          Resource = ["${aws_s3_bucket.files.arn}/*"]
        },
        {
          Effect   = "Allow"
          Action   = ["elasticfilesystem:ClientMount", "elasticfilesystem:ClientWrite", "elasticfilesystem:ClientRootAccess"]
          Resource = [aws_efs_file_system.seed.arn]
        },
      ],
      var.seed_bucket_arn == "" ? [] : [
        {
          Effect   = "Allow"
          Action   = ["s3:ListBucket"]
          Resource = [var.seed_bucket_arn]
        },
        {
          Effect   = "Allow"
          Action   = ["s3:GetObject"]
          Resource = ["${var.seed_bucket_arn}/*"]
        },
      ],
    )
  })
}

# --- Scheduler: start the seed task -------------------------------------------------------------

resource "aws_iam_role" "scheduler" {
  name = "${var.name}-scheduler"
  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect    = "Allow"
      Action    = "sts:AssumeRole"
      Principal = { Service = "scheduler.amazonaws.com" }
    }]
  })
}

resource "aws_iam_role_policy" "scheduler" {
  name = "run-seed"
  role = aws_iam_role.scheduler.id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect   = "Allow"
        Action   = ["ecs:RunTask"]
        Resource = ["arn:aws:ecs:${var.region}:${data.aws_caller_identity.me.account_id}:task-definition/${var.name}-seed:*"]
      },
      {
        Effect   = "Allow"
        Action   = ["iam:PassRole"]
        Resource = [aws_iam_role.execution.arn, aws_iam_role.seed.arn]
      },
    ]
  })
}
