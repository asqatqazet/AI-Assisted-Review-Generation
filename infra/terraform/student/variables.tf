variable "aws_region" {
  type        = string
  description = "AWS region for deployment"
  default     = "eu-central-1"
}

variable "deployment_profile" {
  type        = string
  description = "Reviewed Lambda capacity policy for this deployment"

  validation {
    condition = contains([
      "student-low-quota",
      "reserved-concurrency",
    ], var.deployment_profile)
    error_message = "deployment_profile must be student-low-quota or reserved-concurrency."
  }
}

variable "alert_email" {
  type        = string
  description = "Verified recipient for the student cost alerts"
}

variable "operator_email" {
  type        = string
  description = "Email address invited as the initial Console operator"

  validation {
    condition     = can(regex("^[^@\\s]+@[^@\\s]+\\.[^@\\s]+$", var.operator_email))
    error_message = "operator_email must be a valid email address."
  }
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
