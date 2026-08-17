output "cloudfront_domain_name" {
  value       = aws_cloudfront_distribution.student.domain_name
  description = "Assessment URL host; use https:// plus this value"
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
