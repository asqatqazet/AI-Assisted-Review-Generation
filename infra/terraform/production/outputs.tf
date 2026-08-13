output "db_endpoint" {
  value       = aws_db_instance.postgres.endpoint
  description = "Endpoint of Multi-AZ RDS PostgreSQL cluster"
}

output "generation_function_name" {
  value       = aws_lambda_function.generation_service.function_name
  description = "Production Generation Service Lambda function name"
}
