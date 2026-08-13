variable "aws_region" {
  type        = string
  description = "AWS region for production deployment"
  default     = "eu-west-1"
}

variable "alert_email" {
  type        = string
  description = "Recipient email for production budget alerts"
  default     = "ops-alerts@example.com"
}

variable "subnet_ids" {
  type        = list(string)
  description = "VPC Subnet IDs for RDS Multi-AZ subnet group"
  default     = ["subnet-11111111", "subnet-22222222"]
}

variable "db_password" {
  type        = string
  description = "Master password for RDS database"
  sensitive   = true
  default     = "change-me-in-production-vault"
}
