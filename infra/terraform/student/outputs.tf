output "context_service_alias_arn" {
  value       = aws_lambda_alias.context_service_live.arn
  description = "Private qualified Context Lambda alias invoked only through IAM"
}

output "generation_service_alias_arn" {
  value       = aws_lambda_alias.generation_service_live.arn
  description = "Private qualified Generation Lambda alias invoked only through IAM"
}

output "manifests_bucket_name" {
  value       = aws_s3_bucket.manifests.bucket
  description = "S3 bucket storing review format manifests"
}
