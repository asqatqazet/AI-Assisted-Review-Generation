variable "aws_region" {
  type        = string
  description = "AWS region for deployment"
  default     = "eu-central-1"
}

variable "alert_email" {
  type        = string
  description = "Verified recipient for the student cost alerts"
}

variable "web_bff_artifact_path" {
  type        = string
  description = "Absolute path to the verified Web+BFF Lambda zip"
}

variable "context_artifact_path" {
  type        = string
  description = "Absolute path to the verified Context Lambda zip"
}

variable "generation_artifact_path" {
  type        = string
  description = "Absolute path to the verified Generation Lambda zip"
}
