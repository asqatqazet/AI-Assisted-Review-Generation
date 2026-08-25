output "deployment_profile" {
  value       = var.deployment_profile
  description = "Reviewed Lambda capacity policy applied to this release"
}

output "cloudfront_domain_name" {
  value       = aws_cloudfront_distribution.student.domain_name
  description = "Assessment URL host; use https:// plus this value"
}

output "cloudfront_distribution_id" {
  value       = aws_cloudfront_distribution.student.id
  description = "Distribution invalidated after UI deploy and rollback"
}

output "cutoff_lambda_function_names" {
  value       = sort(values(local.function_names))
  description = "Exact Lambda function set throttled by the scheduled student cutoff"
}

output "reconcile_event_rule_name" {
  value       = aws_cloudwatch_event_rule.reconcile.name
  description = "Scheduled reconciliation rule disabled by the student cutoff"
}

output "ui_bucket_name" {
  value       = aws_s3_bucket.ui.bucket
  description = "Private bucket receiving the verified Vite build"
}

output "context_reviewer_alias_arn" {
  value       = aws_lambda_alias.context_reviewer_live.arn
  description = "Private qualified reviewer Context alias"
}

output "context_console_alias_arn" {
  value       = aws_lambda_alias.context_console_live.arn
  description = "Private qualified Console Context alias"
}

output "context_reviewer_candidate_version_arn" {
  value       = aws_lambda_function.context_reviewer.qualified_arn
  description = "Exact reviewer Context version pinned into the candidate BFF"
}

output "context_console_candidate_version_arn" {
  value       = aws_lambda_function.context_console.qualified_arn
  description = "Exact Console Context version pinned into the candidate BFF"
}

output "generation_service_alias_arn" {
  value       = aws_lambda_alias.generation_service_live.arn
  description = "Private qualified Generation alias"
}

output "generation_candidate_version_arn" {
  value       = aws_lambda_function.generation_service.qualified_arn
  description = "Exact Generation version pinned into the candidate BFF"
}

output "configuration_candidate_release_id" {
  value       = var.configuration_candidate_release_id
  description = "Immutable configuration release selected by the candidate BFF"
}

output "generation_canary_function_name" {
  value       = aws_lambda_function.generation_canary.function_name
  description = "Unaliased FakeProvider-only function used while live Generation is frozen"
}

output "web_bff_fast_alias_arn" {
  value = aws_lambda_alias.web_bff_fast_live.arn
}

output "web_bff_stream_alias_arn" {
  value = aws_lambda_alias.web_bff_stream_live.arn
}

output "web_bff_reconcile_alias_arn" {
  value = aws_lambda_alias.web_bff_reconcile_live.arn
}

output "web_bff_fast_function_url" {
  value = aws_lambda_function_url.web_bff_fast.function_url
}

output "web_bff_stream_function_url" {
  value = aws_lambda_function_url.web_bff_stream.function_url
}

output "operator_oidc_issuer" {
  value       = "https://cognito-idp.${var.aws_region}.amazonaws.com/${aws_cognito_user_pool.operators.id}"
  description = "Trusted issuer validated by the BFF"
}

output "operator_oidc_domain" {
  value       = "https://${aws_cognito_user_pool_domain.operators.domain}.auth.${var.aws_region}.amazoncognito.com"
  description = "Cognito managed-login origin"
}

output "operator_oidc_client_id" {
  value       = aws_cognito_user_pool_client.operator_console.id
  description = "Public PKCE client identifier; no client secret exists"
}

output "operator_subject" {
  value       = aws_cognito_user.initial_operator.sub
  description = "Immutable Cognito subject bound to the initial Operator"
}

output "operator_email" {
  value = var.operator_email
}

output "tenant_operator_subject" {
  value       = try(aws_cognito_user.tenant_operator[0].sub, "")
  description = "Optional Tenant-only Operator Cognito subject; no password is exposed"
}

output "tenant_operator_email" {
  value = var.tenant_operator_email
}
