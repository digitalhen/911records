terraform {
  required_version = ">= 1.6"
  required_providers {
    aws    = { source = "hashicorp/aws", version = "~> 6.0" }
    random = { source = "hashicorp/random", version = "~> 3.6" }
  }
}

provider "aws" {
  region = var.region
  default_tags {
    tags = { Project = var.name }
  }
}

data "aws_availability_zones" "available" {
  state = "available"
}

data "aws_caller_identity" "me" {}

locals {
  azs = slice(data.aws_availability_zones.available.names, 0, 2)
  # Names that must be globally unique (S3) get the account id appended.
  bucket_name = "${var.name}-files-${data.aws_caller_identity.me.account_id}"
}
