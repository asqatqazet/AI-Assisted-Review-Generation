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

output "ui_bucket_name" {
  value       = aws_s3_bucket.ui.bucket
  description = "Private bucket receiving the verified Vite build"
}

output "context_service_alias_arn" {
  value       = aws_lambda_alias.context_service_live.arn
  description = "Private qualified Context alias"
}

output "generation_service_alias_arn" {
  value       = aws_lambda_alias.generation_service_live.arn
  description = "Private qualified Generation alias"
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
