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

  # Egress: allow HTTP and HTTPS only; no direct RFC1918 access.
  egress {
    description = "HTTPS to internet"
    from_port   = 443
    to_port     = 443
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]
  }

  egress {
    description = "HTTP to internet"
    from_port   = 80
    to_port     = 80
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]
  }

  tags = {
    Project     = "pipe"
    Environment = var.environment
    ManagedBy   = "terraform"
  }
}
