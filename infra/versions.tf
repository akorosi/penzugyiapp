terraform {
  required_version = ">= 1.6"

  required_providers {
    aws = {
      source = "hashicorp/aws"
      # aws_dsql_cluster és aws_lambda_permission.invoked_via_function_url miatt
      version = ">= 6.67.0, < 7.0.0"
    }
    archive = {
      source  = "hashicorp/archive"
      version = "~> 2.7"
    }
    random = {
      source  = "hashicorp/random"
      version = "~> 3.6"
    }
  }

  # Az állapot alapértelmezésben helyben (terraform.tfstate) tárolódik. Csapatban
  # vagy több gépről érdemes S3 backendet használni — lásd README.
}

provider "aws" {
  region = var.aws_region

  default_tags {
    tags = {
      Project   = var.project_name
      ManagedBy = "terraform"
    }
  }
}
