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

variable "teardown_date" {
  type        = string
  description = "UTC date after which the fail-safe cutoff disables the assessment"

  validation {
    condition     = can(regex("^[0-9]{4}-[0-9]{2}-[0-9]{2}$", var.teardown_date))
    error_message = "teardown_date must use YYYY-MM-DD."
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

variable "tenant_operator_email" {
  type        = string
  description = "Optional email invited as a Tenant-only Console test operator"
  default     = ""

  validation {
    condition = (
      var.tenant_operator_email == "" ||
      can(regex("^[^@\\s]+@[^@\\s]+\\.[^@\\s]+$", var.tenant_operator_email))
    )
    error_message = "tenant_operator_email must be empty or a valid email address."
  }
}

variable "configuration_candidate_release_id" {
  type        = string
  description = "Immutable configuration release selected only by this BFF version until promotion"

  validation {
    condition     = can(regex("^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$", var.configuration_candidate_release_id))
    error_message = "configuration_candidate_release_id must be a canonical lowercase UUID."
  }
}

variable "web_bff_rollback_service_version_arns" {
  type        = list(string)
  description = "Exact service-version ARNs retained for the immediately previous BFF release"
  default     = []

  validation {
    condition = alltrue([
      for arn in var.web_bff_rollback_service_version_arns : can(regex(
        "^arn:aws:lambda:[^:]+:[0-9]{12}:function:review-(context-reviewer|context-console|generation-(service|canary))-student:[1-9][0-9]*$",
        arn,
      ))
    ])
    error_message = "web_bff_rollback_service_version_arns may contain only exact student service version ARNs."
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
