terraform {
  required_version = ">= 1.7.0"
  backend "s3" {}
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 6.0"
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
data "aws_cloudfront_cache_policy" "caching_optimized" {
  name = "Managed-CachingOptimized"
}
data "aws_cloudfront_cache_policy" "caching_disabled" {
  name = "Managed-CachingDisabled"
}
data "aws_cloudfront_origin_request_policy" "all_viewer_except_host" {
  name = "Managed-AllViewerExceptHostHeader"
}

locals {
  service_role_permissions_boundary_arn = "arn:aws:iam::${data.aws_caller_identity.current.account_id}:policy/ReviewStudentLambdaBoundary"
  function_names = {
    web_bff_fast       = "review-web-bff-fast-student"
    web_bff_stream     = "review-web-bff-stream-student"
    web_bff_reconcile  = "review-web-bff-reconcile-student"
    context_service    = "review-context-service-student"
    context_reviewer   = "review-context-reviewer-student"
    context_console    = "review-context-console-student"
    generation_service = "review-generation-service-student"
    generation_canary  = "review-generation-canary-student"
  }
  lambda_log_group_arns = [
    for name in values(local.function_names) :
    "arn:aws:logs:${var.aws_region}:${data.aws_caller_identity.current.account_id}:log-group:/aws/lambda/${name}:*"
  ]
  parameter_names = {
    context_database_url_legacy       = "/review-gen/student/context-database-url"
    context_runtime_database_url      = "/review-gen/student/context-runtime-database-url"
    console_control_database_url      = "/review-gen/student/console-control-database-url"
    generation_database_url           = "/review-gen/student/generation-database-url"
    review_csrf_secret                = "/review-gen/student/review-csrf-secret"
    operator_session_secret           = "/review-gen/student/operator-session-secret"
    operator_oidc_config              = "/review-gen/student/operator-oidc-config"
    context_work_private_key          = "/review-gen/student/context-work-private-key"
    context_work_public_key           = "/review-gen/student/context-work-public-key"
    console_authority_private_key     = "/review-gen/student/console-authority-private-key"
    console_authority_public_key      = "/review-gen/student/console-authority-public-key"
    console_database_authority_secret = "/review-gen/student/console-database-authority-secret"
    generation_work_private_key       = "/review-gen/student/generation-work-private-key"
    generation_work_public_key        = "/review-gen/student/generation-work-public-key"
    public_source_rate_hmac_secret    = "/review-gen/student/public-source-rate-hmac-secret"
    gemini_api_key                    = "/review-gen/student/gemini-api-key"
  }
}

resource "aws_budgets_budget" "student_cost_limit" {
  name         = "student-monthly-budget-alert"
  budget_type  = "COST"
  limit_amount = "1"
  limit_unit   = "USD"
  time_unit    = "MONTHLY"

  notification {
    comparison_operator        = "GREATER_THAN"
    threshold                  = 50
    threshold_type             = "PERCENTAGE"
    notification_type          = "ACTUAL"
    subscriber_email_addresses = [var.alert_email]
  }

  notification {
    comparison_operator        = "GREATER_THAN"
    threshold                  = 100
    threshold_type             = "PERCENTAGE"
    notification_type          = "FORECASTED"
    subscriber_email_addresses = [var.alert_email]
  }
}

resource "aws_ssm_parameter" "teardown_date" {
  name  = "/review-gen/student/teardown-date"
  type  = "String"
  value = var.teardown_date
}

resource "aws_cognito_user_pool" "operators" {
  name                     = "review-operators-student"
  user_pool_tier           = "LITE"
  username_attributes      = ["email"]
  auto_verified_attributes = ["email"]
  mfa_configuration        = "OPTIONAL"
  deletion_protection      = "INACTIVE"

  password_policy {
    minimum_length                   = 12
    require_lowercase                = true
    require_numbers                  = true
    require_symbols                  = true
    require_uppercase                = true
    temporary_password_validity_days = 7
  }

  admin_create_user_config {
    allow_admin_create_user_only = true
  }

  account_recovery_setting {
    recovery_mechanism {
      name     = "verified_email"
      priority = 1
    }
  }

  software_token_mfa_configuration {
    enabled = true
  }

  user_attribute_update_settings {
    attributes_require_verification_before_update = ["email"]
  }
}

resource "aws_cognito_user_pool_domain" "operators" {
  domain                = "review-operators-${data.aws_caller_identity.current.account_id}"
  user_pool_id          = aws_cognito_user_pool.operators.id
  managed_login_version = 1
}

resource "aws_cognito_user" "initial_operator" {
  user_pool_id             = aws_cognito_user_pool.operators.id
  username                 = var.operator_email
  desired_delivery_mediums = ["EMAIL"]
  attributes = {
    email          = var.operator_email
    email_verified = "true"
  }
}

resource "aws_cognito_user" "tenant_operator" {
  count                    = var.tenant_operator_email == "" ? 0 : 1
  user_pool_id             = aws_cognito_user_pool.operators.id
  username                 = var.tenant_operator_email
  desired_delivery_mediums = ["EMAIL"]
  attributes = {
    email          = var.tenant_operator_email
    email_verified = "true"
  }
}

resource "aws_s3_bucket" "ui" {
  bucket_prefix = "review-ui-student-"
  force_destroy = true
}

resource "aws_s3_bucket_public_access_block" "ui" {
  bucket                  = aws_s3_bucket.ui.id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_server_side_encryption_configuration" "ui" {
  bucket = aws_s3_bucket.ui.id
  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm = "AES256"
    }
  }
}

resource "aws_cloudfront_origin_access_control" "ui" {
  name                              = "review-ui-student"
  origin_access_control_origin_type = "s3"
  signing_behavior                  = "always"
  signing_protocol                  = "sigv4"
}

resource "aws_cloudfront_origin_access_control" "web_bff_fast" {
  name                              = "review-web-bff-fast-student"
  origin_access_control_origin_type = "lambda"
  signing_behavior                  = "always"
  signing_protocol                  = "sigv4"
}

resource "aws_cloudfront_origin_access_control" "web_bff_stream" {
  name                              = "review-web-bff-stream-student"
  origin_access_control_origin_type = "lambda"
  signing_behavior                  = "always"
  signing_protocol                  = "sigv4"
}

data "aws_iam_policy_document" "lambda_assume" {
  statement {
    actions = ["sts:AssumeRole"]
    principals {
      type        = "Service"
      identifiers = ["lambda.amazonaws.com"]
    }
  }
}

resource "aws_iam_role" "web_bff" {
  name                 = "review-web-bff-student-role"
  assume_role_policy   = data.aws_iam_policy_document.lambda_assume.json
  permissions_boundary = local.service_role_permissions_boundary_arn
}

resource "aws_iam_role" "context_service" {
  name                 = "review-context-service-student-role"
  assume_role_policy   = data.aws_iam_policy_document.lambda_assume.json
  permissions_boundary = local.service_role_permissions_boundary_arn
}

resource "aws_iam_role" "context_reviewer" {
  name                 = "review-context-reviewer-student-role"
  assume_role_policy   = data.aws_iam_policy_document.lambda_assume.json
  permissions_boundary = local.service_role_permissions_boundary_arn
}

resource "aws_iam_role" "context_console" {
  name                 = "review-context-console-student-role"
  assume_role_policy   = data.aws_iam_policy_document.lambda_assume.json
  permissions_boundary = local.service_role_permissions_boundary_arn
}

resource "aws_iam_role" "generation_service" {
  name                 = "review-generation-service-student-role"
  assume_role_policy   = data.aws_iam_policy_document.lambda_assume.json
  permissions_boundary = local.service_role_permissions_boundary_arn
}

data "aws_iam_policy_document" "lambda_logs" {
  statement {
    actions   = ["logs:CreateLogStream", "logs:PutLogEvents"]
    resources = local.lambda_log_group_arns
  }
}

resource "aws_iam_role_policy" "web_bff_logs" {
  role   = aws_iam_role.web_bff.id
  policy = data.aws_iam_policy_document.lambda_logs.json
}

resource "aws_iam_role_policy" "context_logs" {
  role   = aws_iam_role.context_service.id
  policy = data.aws_iam_policy_document.lambda_logs.json
}

resource "aws_iam_role_policy" "context_reviewer_logs" {
  role   = aws_iam_role.context_reviewer.id
  policy = data.aws_iam_policy_document.lambda_logs.json
}

resource "aws_iam_role_policy" "context_console_logs" {
  role   = aws_iam_role.context_console.id
  policy = data.aws_iam_policy_document.lambda_logs.json
}

resource "aws_iam_role_policy" "generation_logs" {
  role   = aws_iam_role.generation_service.id
  policy = data.aws_iam_policy_document.lambda_logs.json
}

data "aws_iam_policy_document" "web_bff_parameters" {
  statement {
    actions = ["ssm:GetParameter"]
    resources = [
      "arn:aws:ssm:${var.aws_region}:${data.aws_caller_identity.current.account_id}:parameter${local.parameter_names.review_csrf_secret}",
      "arn:aws:ssm:${var.aws_region}:${data.aws_caller_identity.current.account_id}:parameter${local.parameter_names.operator_session_secret}",
      "arn:aws:ssm:${var.aws_region}:${data.aws_caller_identity.current.account_id}:parameter${local.parameter_names.operator_oidc_config}",
    ]
  }
}

resource "aws_iam_role_policy" "web_bff_parameters" {
  role   = aws_iam_role.web_bff.id
  policy = data.aws_iam_policy_document.web_bff_parameters.json
}

data "aws_iam_policy_document" "context_parameters" {
  statement {
    actions = ["ssm:GetParameter"]
    resources = [
      # Expand-only legacy combined Context. Existing published versions use
      # the historical pointer; a fresh dormant bridge uses the split set.
      "arn:aws:ssm:${var.aws_region}:${data.aws_caller_identity.current.account_id}:parameter${local.parameter_names.context_database_url_legacy}",
      "arn:aws:ssm:${var.aws_region}:${data.aws_caller_identity.current.account_id}:parameter${local.parameter_names.context_runtime_database_url}",
      "arn:aws:ssm:${var.aws_region}:${data.aws_caller_identity.current.account_id}:parameter${local.parameter_names.console_control_database_url}",
      "arn:aws:ssm:${var.aws_region}:${data.aws_caller_identity.current.account_id}:parameter${local.parameter_names.context_work_private_key}",
      "arn:aws:ssm:${var.aws_region}:${data.aws_caller_identity.current.account_id}:parameter${local.parameter_names.console_authority_private_key}",
      "arn:aws:ssm:${var.aws_region}:${data.aws_caller_identity.current.account_id}:parameter${local.parameter_names.console_database_authority_secret}",
      "arn:aws:ssm:${var.aws_region}:${data.aws_caller_identity.current.account_id}:parameter${local.parameter_names.generation_work_public_key}",
      "arn:aws:ssm:${var.aws_region}:${data.aws_caller_identity.current.account_id}:parameter${local.parameter_names.public_source_rate_hmac_secret}",
    ]
  }
}

resource "aws_iam_role_policy" "context_parameters" {
  role   = aws_iam_role.context_service.id
  policy = data.aws_iam_policy_document.context_parameters.json
}

data "aws_iam_policy_document" "context_reviewer_parameters" {
  statement {
    actions = ["ssm:GetParameter"]
    resources = [
      "arn:aws:ssm:${var.aws_region}:${data.aws_caller_identity.current.account_id}:parameter${local.parameter_names.context_runtime_database_url}",
      "arn:aws:ssm:${var.aws_region}:${data.aws_caller_identity.current.account_id}:parameter${local.parameter_names.context_work_private_key}",
      "arn:aws:ssm:${var.aws_region}:${data.aws_caller_identity.current.account_id}:parameter${local.parameter_names.generation_work_public_key}",
      "arn:aws:ssm:${var.aws_region}:${data.aws_caller_identity.current.account_id}:parameter${local.parameter_names.public_source_rate_hmac_secret}",
    ]
  }
}

resource "aws_iam_role_policy" "context_reviewer_parameters" {
  role   = aws_iam_role.context_reviewer.id
  policy = data.aws_iam_policy_document.context_reviewer_parameters.json
}

data "aws_iam_policy_document" "context_console_parameters" {
  statement {
    actions = ["ssm:GetParameter"]
    resources = [
      "arn:aws:ssm:${var.aws_region}:${data.aws_caller_identity.current.account_id}:parameter${local.parameter_names.console_control_database_url}",
      "arn:aws:ssm:${var.aws_region}:${data.aws_caller_identity.current.account_id}:parameter${local.parameter_names.console_authority_private_key}",
      "arn:aws:ssm:${var.aws_region}:${data.aws_caller_identity.current.account_id}:parameter${local.parameter_names.console_database_authority_secret}",
    ]
  }
}

resource "aws_iam_role_policy" "context_console_parameters" {
  role   = aws_iam_role.context_console.id
  policy = data.aws_iam_policy_document.context_console_parameters.json
}

data "aws_iam_policy_document" "generation_parameters" {
  statement {
    actions = ["ssm:GetParameter"]
    resources = concat(
      [
        "arn:aws:ssm:${var.aws_region}:${data.aws_caller_identity.current.account_id}:parameter${local.parameter_names.generation_database_url}",
        "arn:aws:ssm:${var.aws_region}:${data.aws_caller_identity.current.account_id}:parameter${local.parameter_names.context_work_public_key}",
        "arn:aws:ssm:${var.aws_region}:${data.aws_caller_identity.current.account_id}:parameter${local.parameter_names.console_authority_public_key}",
        "arn:aws:ssm:${var.aws_region}:${data.aws_caller_identity.current.account_id}:parameter${local.parameter_names.generation_work_private_key}",
      ],
      var.deployment_profile == "reserved-concurrency" ? [
        "arn:aws:ssm:${var.aws_region}:${data.aws_caller_identity.current.account_id}:parameter${local.parameter_names.gemini_api_key}",
      ] : [],
    )
  }
}

resource "aws_iam_role_policy" "generation_parameters" {
  role   = aws_iam_role.generation_service.id
  policy = data.aws_iam_policy_document.generation_parameters.json
}

data "aws_iam_policy_document" "web_bff_invoke" {
  statement {
    actions = ["lambda:InvokeFunction"]
    resources = concat(
      [
        # Old published BFF versions resolve these aliases during the expand
        # window. The new BFF release below is pinned to exact immutable service
        # versions and cannot follow a later candidate/live alias move.
        aws_lambda_alias.context_service_live.arn,
        aws_lambda_alias.context_reviewer_live.arn,
        aws_lambda_alias.context_console_live.arn,
        aws_lambda_alias.generation_service_live.arn,
        aws_lambda_function.context_reviewer.qualified_arn,
        aws_lambda_function.context_console.qualified_arn,
        aws_lambda_function.generation_service.qualified_arn,
        aws_lambda_function.generation_canary.qualified_arn,
      ],
      var.web_bff_rollback_service_version_arns,
    )
  }
}

resource "aws_iam_role_policy" "web_bff_invoke" {
  role   = aws_iam_role.web_bff.id
  policy = data.aws_iam_policy_document.web_bff_invoke.json
}

resource "aws_cloudwatch_log_group" "web_bff_fast" {
  name              = "/aws/lambda/${local.function_names.web_bff_fast}"
  retention_in_days = 3
}

resource "aws_cloudwatch_log_group" "web_bff_stream" {
  name              = "/aws/lambda/${local.function_names.web_bff_stream}"
  retention_in_days = 3
}

resource "aws_cloudwatch_log_group" "web_bff_reconcile" {
  name              = "/aws/lambda/${local.function_names.web_bff_reconcile}"
  retention_in_days = 3
}

resource "aws_cloudwatch_log_group" "context_service" {
  name              = "/aws/lambda/${local.function_names.context_service}"
  retention_in_days = 3
}

resource "aws_cloudwatch_log_group" "context_reviewer" {
  name              = "/aws/lambda/${local.function_names.context_reviewer}"
  retention_in_days = 3
}

resource "aws_cloudwatch_log_group" "context_console" {
  name              = "/aws/lambda/${local.function_names.context_console}"
  retention_in_days = 3
}

resource "aws_cloudwatch_log_group" "generation_service" {
  name              = "/aws/lambda/${local.function_names.generation_service}"
  retention_in_days = 3
}

resource "aws_cloudwatch_log_group" "generation_canary" {
  name              = "/aws/lambda/${local.function_names.generation_canary}"
  retention_in_days = 3
}

# Expand-only compatibility island. Existing deployments retain the exact
# combined Context code/configuration at this address; new Reviewer and Console
# versions never assume this role. The contract release removes this resource
# only after the old BFF rollback window closes.
resource "aws_lambda_function" "context_service" {
  function_name                  = local.function_names.context_service
  role                           = aws_iam_role.context_service.arn
  handler                        = "main.handler"
  runtime                        = "nodejs24.x"
  memory_size                    = 256
  reserved_concurrent_executions = null
  timeout                        = 7
  filename                       = var.context_artifact_path
  source_code_hash               = filebase64sha256(var.context_artifact_path)
  publish                        = true

  environment {
    variables = {
      CONTEXT_DATABASE_URL_PARAMETER              = local.parameter_names.context_database_url_legacy
      CONTEXT_RUNTIME_DATABASE_URL_PARAMETER      = local.parameter_names.context_runtime_database_url
      CONSOLE_CONTROL_DATABASE_URL_PARAMETER      = local.parameter_names.console_control_database_url
      CONTEXT_WORK_PRIVATE_KEY_PARAMETER          = local.parameter_names.context_work_private_key
      CONSOLE_AUTHORITY_PRIVATE_KEY_PEM_PARAMETER = local.parameter_names.console_authority_private_key
      CONSOLE_DATABASE_AUTHORITY_SECRET_PARAMETER = local.parameter_names.console_database_authority_secret
      GENERATION_WORK_PUBLIC_KEY_PARAMETER        = local.parameter_names.generation_work_public_key
      PUBLIC_SOURCE_RATE_HMAC_SECRET_PARAMETER    = local.parameter_names.public_source_rate_hmac_secret
      REVIEW_PROVIDER_MODE                        = var.deployment_profile == "student-low-quota" ? "fake-only" : "paid-enabled"
    }
  }

  lifecycle {
    ignore_changes = [
      filename,
      source_code_hash,
      handler,
      runtime,
      memory_size,
      timeout,
      environment,
    ]
  }

  depends_on = [aws_cloudwatch_log_group.context_service]
}

resource "aws_lambda_alias" "context_service_live" {
  name             = "live"
  function_name    = aws_lambda_function.context_service.function_name
  function_version = aws_lambda_function.context_service.version

  lifecycle { ignore_changes = [function_version] }
}

resource "aws_lambda_function" "context_reviewer" {
  function_name                  = local.function_names.context_reviewer
  role                           = aws_iam_role.context_reviewer.arn
  handler                        = "reviewer-main.handler"
  runtime                        = "nodejs24.x"
  memory_size                    = 256
  reserved_concurrent_executions = var.deployment_profile == "reserved-concurrency" ? 4 : null
  # The DB statement/transaction budgets remain 2s/4s. The larger invocation
  # envelope accommodates SSM fetch plus a scale-to-zero Neon cold start.
  timeout          = 15
  filename         = var.context_artifact_path
  source_code_hash = filebase64sha256(var.context_artifact_path)
  publish          = true

  environment {
    variables = {
      CONTEXT_RUNTIME_DATABASE_URL_PARAMETER   = local.parameter_names.context_runtime_database_url
      CONTEXT_WORK_PRIVATE_KEY_PARAMETER       = local.parameter_names.context_work_private_key
      GENERATION_WORK_PUBLIC_KEY_PARAMETER     = local.parameter_names.generation_work_public_key
      PUBLIC_SOURCE_RATE_HMAC_SECRET_PARAMETER = local.parameter_names.public_source_rate_hmac_secret
      REVIEW_PROVIDER_MODE                     = var.deployment_profile == "student-low-quota" ? "fake-only" : "paid-enabled"
    }
  }

  depends_on = [aws_cloudwatch_log_group.context_reviewer]
}

resource "aws_lambda_alias" "context_reviewer_live" {
  name             = "live"
  function_name    = aws_lambda_function.context_reviewer.function_name
  function_version = aws_lambda_function.context_reviewer.version

  lifecycle { ignore_changes = [function_version] }
}

resource "aws_lambda_alias" "context_reviewer_candidate" {
  name             = "candidate"
  function_name    = aws_lambda_function.context_reviewer.function_name
  function_version = aws_lambda_function.context_reviewer.version
}

resource "aws_lambda_function" "context_console" {
  function_name                  = local.function_names.context_console
  role                           = aws_iam_role.context_console.arn
  handler                        = "console-main.handler"
  runtime                        = "nodejs24.x"
  memory_size                    = 256
  reserved_concurrent_executions = var.deployment_profile == "reserved-concurrency" ? 1 : null
  timeout                        = 22
  filename                       = var.context_artifact_path
  source_code_hash               = filebase64sha256(var.context_artifact_path)
  publish                        = true

  environment {
    variables = {
      CONSOLE_CONTROL_DATABASE_URL_PARAMETER      = local.parameter_names.console_control_database_url
      CONSOLE_AUTHORITY_PRIVATE_KEY_PEM_PARAMETER = local.parameter_names.console_authority_private_key
      CONSOLE_DATABASE_AUTHORITY_SECRET_PARAMETER = local.parameter_names.console_database_authority_secret
      REVIEW_PROVIDER_MODE                        = var.deployment_profile == "student-low-quota" ? "fake-only" : "paid-enabled"
    }
  }

  depends_on = [aws_cloudwatch_log_group.context_console]
}

resource "aws_lambda_alias" "context_console_live" {
  name             = "live"
  function_name    = aws_lambda_function.context_console.function_name
  function_version = aws_lambda_function.context_console.version

  lifecycle { ignore_changes = [function_version] }
}

resource "aws_lambda_alias" "context_console_candidate" {
  name             = "candidate"
  function_name    = aws_lambda_function.context_console.function_name
  function_version = aws_lambda_function.context_console.version
}

resource "aws_lambda_function" "generation_service" {
  function_name                  = local.function_names.generation_service
  role                           = aws_iam_role.generation_service.arn
  handler                        = "main.handler"
  runtime                        = "nodejs24.x"
  memory_size                    = 512
  reserved_concurrent_executions = var.deployment_profile == "reserved-concurrency" ? 1 : null
  timeout                        = 75
  filename                       = var.generation_artifact_path
  source_code_hash               = filebase64sha256(var.generation_artifact_path)
  publish                        = true

  environment {
    variables = merge(
      {
        GENERATION_DATABASE_URL_PARAMETER          = local.parameter_names.generation_database_url
        CONTEXT_WORK_PUBLIC_KEY_PARAMETER          = local.parameter_names.context_work_public_key
        CONSOLE_AUTHORITY_PUBLIC_KEY_PEM_PARAMETER = local.parameter_names.console_authority_public_key
        GENERATION_WORK_PRIVATE_KEY_PARAMETER      = local.parameter_names.generation_work_private_key
        REVIEW_FAKE_DELAY_MS                       = "0"
        REVIEW_PROVIDER_MODE                       = var.deployment_profile == "student-low-quota" ? "fake-only" : "paid-enabled"
      },
      var.deployment_profile == "reserved-concurrency" ? {
        # Names the parameter, never the key. Low-quota deployments do not
        # receive either this name or permission to resolve it.
        GEMINI_API_KEY_PARAMETER = local.parameter_names.gemini_api_key
      } : {},
    )
  }

  depends_on = [aws_cloudwatch_log_group.generation_service]

  # Deployment freezes the whole function before a paid -> fake-only cutover
  # and releases it only after the verified alias is live. Terraform must not
  # clear that safety lock while applying mutable infrastructure.
  lifecycle { ignore_changes = [reserved_concurrent_executions] }
}

resource "aws_lambda_alias" "generation_service_live" {
  name             = "live"
  function_name    = aws_lambda_function.generation_service.function_name
  function_version = aws_lambda_function.generation_service.version

  lifecycle { ignore_changes = [function_version] }
}

resource "aws_lambda_alias" "generation_service_candidate" {
  name             = "candidate"
  function_name    = aws_lambda_function.generation_service.function_name
  function_version = aws_lambda_function.generation_service.version
}

# Low-quota cutovers freeze the entire live Generation function, including its
# candidate alias. This separate function runs the exact candidate artifact
# with a fixed FakeProvider-only environment and no paid-credential reference.
resource "aws_lambda_function" "generation_canary" {
  function_name    = "review-generation-canary-student"
  role             = aws_iam_role.generation_service.arn
  handler          = "main.handler"
  runtime          = "nodejs24.x"
  memory_size      = 512
  timeout          = 75
  filename         = var.generation_artifact_path
  source_code_hash = filebase64sha256(var.generation_artifact_path)
  publish          = true

  environment {
    variables = {
      GENERATION_DATABASE_URL_PARAMETER          = local.parameter_names.generation_database_url
      CONTEXT_WORK_PUBLIC_KEY_PARAMETER          = local.parameter_names.context_work_public_key
      CONSOLE_AUTHORITY_PUBLIC_KEY_PEM_PARAMETER = local.parameter_names.console_authority_public_key
      GENERATION_WORK_PRIVATE_KEY_PARAMETER      = local.parameter_names.generation_work_private_key
      REVIEW_FAKE_DELAY_MS                       = "0"
      REVIEW_PROVIDER_MODE                       = "fake-only"
    }
  }

  depends_on = [aws_cloudwatch_log_group.generation_canary]
}

locals {
  web_bff_environment = {
    # The names remain backward-compatible with the BFF runtime, but the values
    # are exact published version ARNs rather than mutable aliases.
    CONTEXT_REVIEWER_FUNCTION_ALIAS_ARN = aws_lambda_function.context_reviewer.qualified_arn
    CONTEXT_CONSOLE_FUNCTION_ALIAS_ARN  = aws_lambda_function.context_console.qualified_arn
    GENERATION_FUNCTION_ALIAS_ARN       = aws_lambda_function.generation_service.qualified_arn
    GENERATION_CANDIDATE_FUNCTION_ALIAS_ARN = (
      var.deployment_profile == "student-low-quota"
      ? aws_lambda_function.generation_canary.qualified_arn
      : aws_lambda_function.generation_service.qualified_arn
    )
    REVIEW_CONFIGURATION_RELEASE_ID   = var.configuration_candidate_release_id
    REVIEW_CSRF_SECRET_PARAMETER      = local.parameter_names.review_csrf_secret
    OPERATOR_SESSION_SECRET_PARAMETER = local.parameter_names.operator_session_secret
    OPERATOR_OIDC_CONFIG_PARAMETER    = local.parameter_names.operator_oidc_config
  }
}

resource "aws_lambda_function" "web_bff_fast" {
  function_name                  = local.function_names.web_bff_fast
  role                           = aws_iam_role.web_bff.arn
  handler                        = "main.handler"
  runtime                        = "nodejs24.x"
  memory_size                    = 256
  reserved_concurrent_executions = var.deployment_profile == "reserved-concurrency" ? 5 : null
  timeout                        = 25
  filename                       = var.web_bff_artifact_path
  source_code_hash               = filebase64sha256(var.web_bff_artifact_path)
  publish                        = true

  environment { variables = local.web_bff_environment }
  depends_on = [aws_cloudwatch_log_group.web_bff_fast]
}

resource "aws_lambda_alias" "web_bff_fast_live" {
  name             = "live"
  function_name    = aws_lambda_function.web_bff_fast.function_name
  function_version = aws_lambda_function.web_bff_fast.version

  lifecycle { ignore_changes = [function_version] }
}

resource "aws_lambda_alias" "web_bff_fast_candidate" {
  name             = "candidate"
  function_name    = aws_lambda_function.web_bff_fast.function_name
  function_version = aws_lambda_function.web_bff_fast.version
}

resource "aws_lambda_function" "web_bff_stream" {
  function_name                  = local.function_names.web_bff_stream
  role                           = aws_iam_role.web_bff.arn
  handler                        = "stream-main.handler"
  runtime                        = "nodejs24.x"
  memory_size                    = 256
  reserved_concurrent_executions = var.deployment_profile == "reserved-concurrency" ? 2 : null
  timeout                        = 85
  filename                       = var.web_bff_artifact_path
  source_code_hash               = filebase64sha256(var.web_bff_artifact_path)
  publish                        = true

  environment { variables = local.web_bff_environment }
  depends_on = [aws_cloudwatch_log_group.web_bff_stream]
}

resource "aws_lambda_alias" "web_bff_stream_live" {
  name             = "live"
  function_name    = aws_lambda_function.web_bff_stream.function_name
  function_version = aws_lambda_function.web_bff_stream.version

  lifecycle { ignore_changes = [function_version] }
}

resource "aws_lambda_alias" "web_bff_stream_candidate" {
  name             = "candidate"
  function_name    = aws_lambda_function.web_bff_stream.function_name
  function_version = aws_lambda_function.web_bff_stream.version
}

resource "aws_lambda_function" "web_bff_reconcile" {
  function_name    = local.function_names.web_bff_reconcile
  role             = aws_iam_role.web_bff.arn
  handler          = "reconcile-main.handler"
  runtime          = "nodejs24.x"
  memory_size      = 128
  timeout          = 30
  filename         = var.web_bff_artifact_path
  source_code_hash = filebase64sha256(var.web_bff_artifact_path)
  publish          = true

  environment { variables = local.web_bff_environment }
  depends_on = [aws_cloudwatch_log_group.web_bff_reconcile]
}

resource "aws_lambda_alias" "web_bff_reconcile_live" {
  name             = "live"
  function_name    = aws_lambda_function.web_bff_reconcile.function_name
  function_version = aws_lambda_function.web_bff_reconcile.version

  lifecycle { ignore_changes = [function_version] }
}

resource "aws_lambda_alias" "web_bff_reconcile_candidate" {
  name             = "candidate"
  function_name    = aws_lambda_function.web_bff_reconcile.function_name
  function_version = aws_lambda_function.web_bff_reconcile.version
}

resource "aws_lambda_function_url" "web_bff_fast" {
  function_name      = aws_lambda_function.web_bff_fast.function_name
  qualifier          = aws_lambda_alias.web_bff_fast_live.name
  authorization_type = "AWS_IAM"
  invoke_mode        = "BUFFERED"
}

resource "aws_lambda_function_url" "web_bff_stream" {
  function_name      = aws_lambda_function.web_bff_stream.function_name
  qualifier          = aws_lambda_alias.web_bff_stream_live.name
  authorization_type = "AWS_IAM"
  invoke_mode        = "RESPONSE_STREAM"
}

resource "aws_cloudfront_function" "spa_rewrite" {
  name    = "review-spa-rewrite-student"
  runtime = "cloudfront-js-2.0"
  publish = true
  code    = file("${path.module}/spa-rewrite.js")
}

resource "aws_cloudfront_function" "api_origin" {
  name    = "review-api-origin-student"
  runtime = "cloudfront-js-2.0"
  publish = true
  code    = file("${path.module}/api-origin.js")
}

resource "aws_cloudfront_response_headers_policy" "browser_security" {
  name = "review-browser-security-student"

  security_headers_config {
    content_security_policy {
      content_security_policy = "default-src 'self'; base-uri 'self'; connect-src 'self'; font-src 'self'; frame-ancestors 'none'; img-src 'self' data:; object-src 'none'; script-src 'self'; style-src 'self'; form-action 'self'"
      override                = true
    }

    content_type_options {
      override = true
    }

    frame_options {
      frame_option = "DENY"
      override     = true
    }

    referrer_policy {
      referrer_policy = "strict-origin-when-cross-origin"
      override        = true
    }

    strict_transport_security {
      access_control_max_age_sec = 63072000
      include_subdomains         = true
      preload                    = true
      override                   = true
    }
  }

  custom_headers_config {
    items {
      header   = "Permissions-Policy"
      value    = "camera=(), geolocation=(), microphone=(), payment=(), usb=()"
      override = true
    }
    items {
      header   = "X-Robots-Tag"
      value    = "noindex, nofollow, noarchive"
      override = true
    }
  }
}

resource "aws_cloudfront_distribution" "student" {
  enabled             = true
  is_ipv6_enabled     = true
  default_root_object = "index.html"
  price_class         = "PriceClass_100"
  http_version        = "http2and3"

  origin {
    domain_name              = aws_s3_bucket.ui.bucket_regional_domain_name
    origin_id                = "ui"
    origin_access_control_id = aws_cloudfront_origin_access_control.ui.id
  }

  origin {
    domain_name              = trimsuffix(trimprefix(aws_lambda_function_url.web_bff_fast.function_url, "https://"), "/")
    origin_id                = "web-bff-fast"
    origin_access_control_id = aws_cloudfront_origin_access_control.web_bff_fast.id
    custom_origin_config {
      http_port                = 80
      https_port               = 443
      origin_protocol_policy   = "https-only"
      origin_ssl_protocols     = ["TLSv1.2"]
      origin_read_timeout      = 30
      origin_keepalive_timeout = 5
    }
  }

  origin {
    domain_name                 = trimsuffix(trimprefix(aws_lambda_function_url.web_bff_stream.function_url, "https://"), "/")
    origin_id                   = "web-bff-stream"
    origin_access_control_id    = aws_cloudfront_origin_access_control.web_bff_stream.id
    response_completion_timeout = 95
    custom_origin_config {
      http_port                = 80
      https_port               = 443
      origin_protocol_policy   = "https-only"
      origin_ssl_protocols     = ["TLSv1.2"]
      origin_read_timeout      = 30
      origin_keepalive_timeout = 5
    }
  }

  default_cache_behavior {
    target_origin_id           = "ui"
    viewer_protocol_policy     = "redirect-to-https"
    allowed_methods            = ["GET", "HEAD", "OPTIONS"]
    cached_methods             = ["GET", "HEAD"]
    cache_policy_id            = data.aws_cloudfront_cache_policy.caching_optimized.id
    response_headers_policy_id = aws_cloudfront_response_headers_policy.browser_security.id
    compress                   = true
    function_association {
      event_type   = "viewer-request"
      function_arn = aws_cloudfront_function.spa_rewrite.arn
    }
  }

  ordered_cache_behavior {
    path_pattern               = "/auth/*"
    target_origin_id           = "web-bff-fast"
    viewer_protocol_policy     = "redirect-to-https"
    allowed_methods            = ["GET", "HEAD", "OPTIONS", "PUT", "PATCH", "POST", "DELETE"]
    cached_methods             = ["GET", "HEAD"]
    cache_policy_id            = data.aws_cloudfront_cache_policy.caching_disabled.id
    origin_request_policy_id   = data.aws_cloudfront_origin_request_policy.all_viewer_except_host.id
    response_headers_policy_id = aws_cloudfront_response_headers_policy.browser_security.id
    compress                   = false
    function_association {
      event_type   = "viewer-request"
      function_arn = aws_cloudfront_function.api_origin.arn
    }
  }

  ordered_cache_behavior {
    path_pattern               = "/api/v1/review-sessions/*/generations"
    target_origin_id           = "web-bff-stream"
    viewer_protocol_policy     = "redirect-to-https"
    allowed_methods            = ["GET", "HEAD", "OPTIONS", "PUT", "PATCH", "POST", "DELETE"]
    cached_methods             = ["GET", "HEAD"]
    cache_policy_id            = data.aws_cloudfront_cache_policy.caching_disabled.id
    origin_request_policy_id   = data.aws_cloudfront_origin_request_policy.all_viewer_except_host.id
    response_headers_policy_id = aws_cloudfront_response_headers_policy.browser_security.id
    compress                   = false
    function_association {
      event_type   = "viewer-request"
      function_arn = aws_cloudfront_function.api_origin.arn
    }
  }

  ordered_cache_behavior {
    path_pattern               = "/api/v1/*"
    target_origin_id           = "web-bff-fast"
    viewer_protocol_policy     = "redirect-to-https"
    allowed_methods            = ["GET", "HEAD", "OPTIONS", "PUT", "PATCH", "POST", "DELETE"]
    cached_methods             = ["GET", "HEAD"]
    cache_policy_id            = data.aws_cloudfront_cache_policy.caching_disabled.id
    origin_request_policy_id   = data.aws_cloudfront_origin_request_policy.all_viewer_except_host.id
    response_headers_policy_id = aws_cloudfront_response_headers_policy.browser_security.id
    compress                   = false
    function_association {
      event_type   = "viewer-request"
      function_arn = aws_cloudfront_function.api_origin.arn
    }
  }

  ordered_cache_behavior {
    path_pattern               = "/s/*"
    target_origin_id           = "web-bff-fast"
    viewer_protocol_policy     = "redirect-to-https"
    allowed_methods            = ["GET", "HEAD", "OPTIONS"]
    cached_methods             = ["GET", "HEAD"]
    cache_policy_id            = data.aws_cloudfront_cache_policy.caching_disabled.id
    origin_request_policy_id   = data.aws_cloudfront_origin_request_policy.all_viewer_except_host.id
    response_headers_policy_id = aws_cloudfront_response_headers_policy.browser_security.id
    compress                   = false
    function_association {
      event_type   = "viewer-request"
      function_arn = aws_cloudfront_function.api_origin.arn
    }
  }

  ordered_cache_behavior {
    path_pattern               = "/health"
    target_origin_id           = "web-bff-fast"
    viewer_protocol_policy     = "redirect-to-https"
    allowed_methods            = ["GET", "HEAD", "OPTIONS"]
    cached_methods             = ["GET", "HEAD"]
    cache_policy_id            = data.aws_cloudfront_cache_policy.caching_disabled.id
    origin_request_policy_id   = data.aws_cloudfront_origin_request_policy.all_viewer_except_host.id
    response_headers_policy_id = aws_cloudfront_response_headers_policy.browser_security.id
    compress                   = false
    function_association {
      event_type   = "viewer-request"
      function_arn = aws_cloudfront_function.api_origin.arn
    }
  }

  restrictions {
    geo_restriction { restriction_type = "none" }
  }

  viewer_certificate {
    cloudfront_default_certificate = true
    minimum_protocol_version       = "TLSv1.2_2021"
  }
}

data "aws_iam_policy_document" "ui_bucket" {
  statement {
    actions   = ["s3:GetObject"]
    resources = ["${aws_s3_bucket.ui.arn}/*"]
    principals {
      type        = "Service"
      identifiers = ["cloudfront.amazonaws.com"]
    }
    condition {
      test     = "StringEquals"
      variable = "AWS:SourceArn"
      values   = [aws_cloudfront_distribution.student.arn]
    }
  }
}

resource "aws_s3_bucket_policy" "ui" {
  bucket = aws_s3_bucket.ui.id
  policy = data.aws_iam_policy_document.ui_bucket.json
}

resource "aws_lambda_permission" "cloudfront_fast_url" {
  statement_id           = "AllowCloudFrontFunctionUrl"
  action                 = "lambda:InvokeFunctionUrl"
  function_name          = aws_lambda_function.web_bff_fast.function_name
  qualifier              = aws_lambda_alias.web_bff_fast_live.name
  principal              = "cloudfront.amazonaws.com"
  source_arn             = aws_cloudfront_distribution.student.arn
  function_url_auth_type = "AWS_IAM"
}

resource "aws_lambda_permission" "cloudfront_fast_invoke" {
  statement_id             = "AllowCloudFrontInvokeFunction"
  action                   = "lambda:InvokeFunction"
  function_name            = aws_lambda_function.web_bff_fast.function_name
  qualifier                = aws_lambda_alias.web_bff_fast_live.name
  principal                = "cloudfront.amazonaws.com"
  source_arn               = aws_cloudfront_distribution.student.arn
  invoked_via_function_url = true
}

resource "aws_lambda_permission" "cloudfront_stream_url" {
  statement_id           = "AllowCloudFrontFunctionUrl"
  action                 = "lambda:InvokeFunctionUrl"
  function_name          = aws_lambda_function.web_bff_stream.function_name
  qualifier              = aws_lambda_alias.web_bff_stream_live.name
  principal              = "cloudfront.amazonaws.com"
  source_arn             = aws_cloudfront_distribution.student.arn
  function_url_auth_type = "AWS_IAM"
}

resource "aws_lambda_permission" "cloudfront_stream_invoke" {
  statement_id             = "AllowCloudFrontInvokeFunction"
  action                   = "lambda:InvokeFunction"
  function_name            = aws_lambda_function.web_bff_stream.function_name
  qualifier                = aws_lambda_alias.web_bff_stream_live.name
  principal                = "cloudfront.amazonaws.com"
  source_arn               = aws_cloudfront_distribution.student.arn
  invoked_via_function_url = true
}

resource "aws_cloudwatch_event_rule" "reconcile" {
  name                = "review-reconcile-student"
  schedule_expression = "rate(1 hour)"
}

resource "aws_cloudwatch_event_target" "reconcile" {
  rule = aws_cloudwatch_event_rule.reconcile.name
  arn  = aws_lambda_alias.web_bff_reconcile_live.arn
}

resource "aws_lambda_permission" "eventbridge_reconcile" {
  statement_id  = "AllowEventBridgeReconciliation"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.web_bff_reconcile.function_name
  qualifier     = aws_lambda_alias.web_bff_reconcile_live.name
  principal     = "events.amazonaws.com"
  source_arn    = aws_cloudwatch_event_rule.reconcile.arn
}

resource "aws_cognito_user_pool_client" "operator_console" {
  name         = "review-operator-console-student"
  user_pool_id = aws_cognito_user_pool.operators.id

  generate_secret                      = false
  allowed_oauth_flows_user_pool_client = true
  allowed_oauth_flows                  = ["code"]
  allowed_oauth_scopes                 = ["openid", "email", "profile"]
  supported_identity_providers         = ["COGNITO"]
  callback_urls                        = ["https://${aws_cloudfront_distribution.student.domain_name}/auth/callback"]
  logout_urls                          = ["https://${aws_cloudfront_distribution.student.domain_name}/console"]
  prevent_user_existence_errors        = "ENABLED"
  enable_token_revocation              = true

  id_token_validity      = 60
  access_token_validity  = 60
  refresh_token_validity = 1

  token_validity_units {
    id_token      = "minutes"
    access_token  = "minutes"
    refresh_token = "days"
  }

  depends_on = [aws_cognito_user_pool_domain.operators]
}
