output "cluster_arn" {
  description = "ECS cluster ARN"
  value       = aws_ecs_cluster.pipe_dev_containers.arn
}

output "task_definition_arn" {
  description = "ECS task definition ARN (latest revision)"
  value       = aws_ecs_task_definition.code_server.arn
}

output "security_group_id" {
  description = "code-server security group ID"
  value       = aws_security_group.code_server.id
}

output "subnet_ids" {
  description = "Default VPC subnet IDs used for Fargate tasks"
  value       = data.aws_subnets.default.ids
}

output "log_group_name" {
  description = "CloudWatch log group name"
  value       = aws_cloudwatch_log_group.code_server.name
}

output "task_execution_role_arn" {
  description = "ECS task execution IAM role ARN"
  value       = aws_iam_role.ecs_task_execution.arn
}
