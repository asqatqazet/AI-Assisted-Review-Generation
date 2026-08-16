variable "aws_region" {
  type        = string
  description = "AWS region for deployment"
  default     = "eu-central-1"
}

variable "alert_email" {
  type        = string
  description = "Recipient email for budget alerts"
  default     = "alerts@example.com"
}

variable "context_artifact_path" {
  type        = string
  description = "Absolute path to the verified Context Lambda zip artifact"
}

variable "generation_artifact_path" {
  type        = string
  description = "Absolute path to the verified Generation Lambda zip artifact"
}
