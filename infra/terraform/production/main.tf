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
      Environment = "production"
      ManagedBy   = "Terraform"
    }
  }
}

# 1. AWS Budget Alarm ($500 Production Target)
resource "aws_budgets_budget" "prod_cost_limit" {
  name              = "production-monthly-budget"
  budget_type       = "COST"
  limit_amount      = "500"
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
}

# 2. Production RDS Multi-AZ Postgres (t4g.medium)
resource "aws_db_subnet_group" "db_subnets" {
  name       = "review-db-subnets-prod"
  subnet_ids = var.subnet_ids
}

resource "aws_db_instance" "postgres" {
  identifier                = "review-postgres-prod"
  engine                    = "postgres"
  engine_version            = "16.2"
  instance_class            = "db.t4g.medium"
  allocated_storage         = 50
  max_allocated_storage     = 200
  storage_type              = "gp3"
  multi_az                  = true
  db_subnet_group_name      = aws_db_subnet_group.db_subnets.name
  skip_final_snapshot       = false
  final_snapshot_identifier = "review-postgres-prod-final"
  storage_encrypted         = true
  deletion_protection       = true
  username                  = "review_admin"
  password                  = var.db_password
}

# 3. S3 Manifest Storage
resource "aws_s3_bucket" "manifests" {
  bucket_prefix = "review-manifests-prod-"
}

# 4. IAM Roles
resource "aws_iam_role" "generation_service_role" {
  name = "review-generation-service-prod-role"

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

# 5. Production Lambda with Provisioned Concurrency
resource "aws_lambda_function" "generation_service" {
  function_name = "review-generation-service-prod"
  role          = aws_iam_role.generation_service_role.arn
  handler       = "main.handler"
  runtime       = "nodejs20.x"
  memory_size   = 1024
  timeout       = 30
  filename      = "${path.module}/dummy-gen.zip"

  lifecycle {
    ignore_changes = [filename, source_code_hash]
  }
}

resource "aws_lambda_alias" "generation_service_live" {
  name             = "live"
  function_name    = aws_lambda_function.generation_service.function_name
  function_version = "1"
}

resource "aws_lambda_provisioned_concurrency_config" "generation_concurrency" {
  function_name                     = aws_lambda_function.generation_service.function_name
  qualifier                         = aws_lambda_alias.generation_service_live.name
  provisioned_concurrent_executions = 5
}
