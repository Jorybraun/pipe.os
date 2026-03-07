# SSM parameters let Amplify Lambdas read shared infra ARNs at runtime
# without hardcoding them in amplify/backend.ts

resource "aws_ssm_parameter" "cluster_arn" {
  name  = "/pipe/${var.environment}/shared/ecs/cluster-arn"
  type  = "String"
  value = aws_ecs_cluster.pipe_dev_containers.arn

  tags = { ManagedBy = "terraform" }
}

resource "aws_ssm_parameter" "task_definition_arn" {
  name  = "/pipe/${var.environment}/shared/ecs/task-definition-arn"
  type  = "String"
  value = aws_ecs_task_definition.code_server.arn

  tags = { ManagedBy = "terraform" }
}

resource "aws_ssm_parameter" "security_group_id" {
  name  = "/pipe/${var.environment}/shared/ecs/security-group-id"
  type  = "String"
  value = aws_security_group.code_server.id

  tags = { ManagedBy = "terraform" }
}

resource "aws_ssm_parameter" "alb_domain" {
  name  = "/pipe/${var.environment}/shared/alb/domain"
  type  = "String"
  value = var.alb_domain

  tags = { ManagedBy = "terraform" }
}

resource "aws_ssm_parameter" "subnet_ids" {
  name  = "/pipe/${var.environment}/shared/ecs/subnet-ids"
  type  = "String"
  value = join(",", data.aws_subnets.default.ids)

  tags = { ManagedBy = "terraform" }
}
