# Application Load Balancer for dev container session routing.
#
# Architecture:
#   Browser → ALB:80 /session/{id}/* → Target Group (container IP:8080)
#
# Per-session listener rules are created dynamically by the ecsStatusBridge Lambda
# on ECS RUNNING events, and deleted on STOPPED events.
# The ALB itself is a long-lived shared resource (not per-session).

# ALB security group — accepts HTTP from the internet
resource "aws_security_group" "alb" {
  name        = "pipe-${var.environment}-alb"
  description = "ALB inbound HTTP"
  vpc_id      = data.aws_vpc.default.id

  ingress {
    description = "HTTP from internet"
    from_port   = 80
    to_port     = 80
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

resource "aws_lb" "dev_containers" {
  name               = "pipe-dev-containers"
  internal           = false
  load_balancer_type = "application"
  security_groups    = [aws_security_group.alb.id]
  subnets            = data.aws_subnets.default.ids

  tags = {
    Project     = "pipe"
    Environment = var.environment
    ManagedBy   = "terraform"
  }
}

# HTTP listener — default action returns 404 "No session".
# Per-session listener rules (created by ecsStatusBridge) forward
# /session/{id}/* requests to the container's target group.
resource "aws_lb_listener" "http" {
  load_balancer_arn = aws_lb.dev_containers.arn
  port              = 80
  protocol          = "HTTP"

  default_action {
    type = "fixed-response"
    fixed_response {
      content_type = "text/plain"
      message_body = "No session"
      status_code  = "404"
    }
  }
}
