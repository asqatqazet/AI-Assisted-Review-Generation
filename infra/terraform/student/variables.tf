variable "aws_region" {
  type        = string
  description = "AWS region for deployment"
  default     = "eu-west-1"
}

variable "alert_email" {
  type        = string
  description = "Recipient email for budget alerts"
  default     = "alerts@example.com"
}
