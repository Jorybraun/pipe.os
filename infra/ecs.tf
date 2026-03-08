resource "aws_ecs_cluster" "pipe_dev_containers" {
  name = "pipe-dev-containers"

  tags = {
    Project     = "pipe"
    Environment = var.environment
    ManagedBy   = "terraform"
  }
}

resource "aws_ecs_task_definition" "code_server" {
  family                   = "pipe-code-server"
  requires_compatibilities = ["FARGATE"]
  network_mode             = "awsvpc"
  cpu                      = 1024
  memory                   = 2048
  execution_role_arn       = aws_iam_role.ecs_task_execution.arn

  container_definitions = jsonencode([{
    name      = "code-server"
    image     = "codercom/code-server:4.22.1"
    essential = true

    environment = [
      {
        name  = "CS_DISABLE_GETTING_STARTED_OVERRIDE"
        value = "true"
      },
      {
        name  = "PASSWORD"
        value = ""
      }
    ]

    portMappings = [{
      containerPort = 8080
      protocol      = "tcp"
    }]

    logConfiguration = {
      logDriver = "awslogs"
      options = {
        "awslogs-group"         = aws_cloudwatch_log_group.code_server.name
        "awslogs-region"        = var.aws_region
        "awslogs-stream-prefix" = "code-server"
      }
    }
  }])

  tags = {
    Project     = "pipe"
    Environment = var.environment
    ManagedBy   = "terraform"
  }
}
