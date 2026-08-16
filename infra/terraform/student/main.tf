terraform {
  required_version = ">= 1.7.0"
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.50"
    }
  }
}

provider "aws" {
  region = var.aws_region
  default_tags {
    tags = {
      Project     = "AI-Assisted-Review-Generation"
      Environment = "student"
      ManagedBy   = "Terraform"
    }
  }
}

data "aws_caller_identity" "current" {}

# 1. AWS Budget Alarm ($10 Hard Limit)
resource "aws_budgets_budget" "student_cost_limit" {
  name              = "student-monthly-budget"
  budget_type       = "COST"
  limit_amount      = "10"
  limit_unit        = "USD"
  time_unit         = "MONTHLY"
  time_period_start = "2026-01-01_00:00"

  notification {
    comparison_operator        = "GREATER_THAN"
    threshold                  = 80
    threshold_type             = "PERCENTAGE"
    notification_type          = "ACTUAL"
    subscriber_email_addresses = [var.alert_email]
  }

  notification {
    comparison_operator        = "GREATER_THAN"
    threshold                  = 100
    threshold_type             = "PERCENTAGE"
    notification_type          = "ACTUAL"
    subscriber_email_addresses = [var.alert_email]
  }
}

# 2. S3 Manifests Storage
resource "aws_s3_bucket" "manifests" {
  bucket_prefix = "review-manifests-student-"
  force_destroy = true
}

resource "aws_s3_bucket_public_access_block" "manifests_block" {
  bucket                  = aws_s3_bucket.manifests.id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

# 3. IAM Roles (Disjoint least-privilege)
resource "aws_iam_role" "context_service_role" {
  name = "review-context-service-student-role"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Action = "sts:AssumeRole"
      Effect = "Allow"
      Principal = {
        Service = "lambda.amazonaws.com"
      }
    }]
  })
}

resource "aws_iam_policy" "context_service_policy" {
  name = "review-context-service-student-policy"

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect = "Allow"
        Action = [
          "logs:CreateLogGroup",
          "logs:CreateLogStream",
          "logs:PutLogEvents"
        ]
        Resource = "arn:aws:logs:*:*:*"
      },
      {
        Effect = "Allow"
        Action = [
          "s3:GetObject",
          "s3:ListBucket"
        ]
        Resource = [
          aws_s3_bucket.manifests.arn,
          "${aws_s3_bucket.manifests.arn}/*"
        ]
      }
    ]
  })
}

resource "aws_iam_role_policy_attachment" "context_service_attach" {
  role       = aws_iam_role.context_service_role.name
  policy_arn = aws_iam_policy.context_service_policy.arn
}

resource "aws_iam_role" "generation_service_role" {
  name = "review-generation-service-student-role"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Action = "sts:AssumeRole"
      Effect = "Allow"
      Principal = {
        Service = "lambda.amazonaws.com"
      }
    }]
  })
}

resource "aws_iam_policy" "generation_service_policy" {
  name = "review-generation-service-student-policy"

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect = "Allow"
        Action = [
          "logs:CreateLogGroup",
          "logs:CreateLogStream",
          "logs:PutLogEvents"
        ]
        Resource = "arn:aws:logs:*:*:*"
      },
      {
        Effect = "Allow"
        Action = [
          "ssm:GetParameter",
          "ssm:GetParameters"
        ]
        Resource = "arn:aws:ssm:${var.aws_region}:${data.aws_caller_identity.current.account_id}:parameter/review-gen/student/providers/*"
      }
    ]
  })
}

resource "aws_iam_role_policy_attachment" "generation_service_attach" {
  role       = aws_iam_role.generation_service_role.name
  policy_arn = aws_iam_policy.generation_service_policy.arn
}

# 4. Lambda Functions & Aliases
resource "aws_lambda_function" "context_service" {
  function_name = "review-context-service-student"
  role          = aws_iam_role.context_service_role.arn
  handler       = "main.handler"
  runtime       = "nodejs20.x"
  memory_size   = 256
  timeout       = 10
  filename      = "${path.module}/dummy-context.zip"

  environment {
    variables = {
      NODE_ENV       = "production"
      MANIFEST_BUCKET = aws_s3_bucket.manifests.bucket
    }
  }

  lifecycle {
    ignore_changes = [filename, source_code_hash]
  }
}

resource "aws_lambda_alias" "context_service_live" {
  name             = "live"
  function_name    = aws_lambda_function.context_service.function_name
  function_version = "$LATEST"
}

resource "aws_lambda_function" "generation_service" {
  function_name = "review-generation-service-student"
  role          = aws_iam_role.generation_service_role.arn
  handler       = "main.handler"
  runtime       = "nodejs20.x"
  memory_size   = 512
  timeout       = 75
  filename      = "${path.module}/dummy-gen.zip"

  environment {
    variables = {
      NODE_ENV = "production"
    }
  }

  lifecycle {
    ignore_changes = [filename, source_code_hash]
  }
}

resource "aws_lambda_alias" "generation_service_live" {
  name             = "live"
  function_name    = aws_lambda_function.generation_service.function_name
  function_version = "$LATEST"
}
