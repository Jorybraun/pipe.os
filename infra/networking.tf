data "aws_vpc" "default" {
  default = true
}

data "aws_subnets" "default" {
  filter {
    name   = "vpc-id"
    values = [data.aws_vpc.default.id]
  }
}

resource "aws_security_group" "code_server" {
  name        = "pipe-${var.environment}-code-server"
  description = "Dev container code-server access"
  vpc_id      = data.aws_vpc.default.id

  ingress {
    description     = "code-server port ALB only"
    from_port       = 8080
    to_port         = 8080
    protocol        = "tcp"
    security_groups = [aws_security_group.alb.id]
  }

  # Direct access for prototype — code-server doesn't support --base-path,
  # so we bypass the ALB and hit containers via public IP. Will be removed
  # when nginx sidecar is added for production ALB path-rewriting.
  ingress {
    description = "code-server direct access (prototype)"
    from_port   = 8080
    to_port     = 8080
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]
  }

  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }

  tags = {
    Project     = "pipe"
    Environment = var.environment
    ManagedBy   = "terraform"
  }
}
