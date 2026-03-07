terraform {
  required_version = ">= 1.7"
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
  }

  # Local state for now (solo project).
  # To migrate to S3: create a bucket, uncomment below, then run:
  #   terraform init -migrate-state
  #
  # backend "s3" {
  #   bucket = "pipe-terraform-state"
  #   key    = "shared/terraform.tfstate"
  #   region = "us-west-2"
  # }
}

provider "aws" {
  region = var.aws_region
}
