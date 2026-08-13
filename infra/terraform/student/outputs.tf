output "context_service_url" {
  value       = aws_lambda_function_url.context_service_url.function_url
  description = "Public URL for context-service Lambda"
}

output "generation_service_url" {
  value       = aws_lambda_function_url.generation_service_url.function_url
  description = "Streaming Function URL for generation-service Lambda"
}

output "manifests_bucket_name" {
  value       = aws_s3_bucket.manifests.bucket
  description = "S3 bucket storing review format manifests"
}
