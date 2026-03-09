variable "aws_region" {
  description = "AWS region for all resources"
  type        = string
  default     = "us-west-2"
}

variable "environment" {
  description = "Environment name (dev or prod)"
  type        = string
  default     = "dev"
  validation {
    condition     = contains(["dev", "prod"], var.environment)
    error_message = "environment must be 'dev' or 'prod'."
  }
}

variable "alb_domain" {
  description = "ALB domain for dev container routing (e.g. env.pipe.dev)"
  type        = string
  default     = "env.pipe.dev"
}
