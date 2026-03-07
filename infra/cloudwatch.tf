resource "aws_cloudwatch_log_group" "code_server" {
  name              = "/pipe/dev-containers/code-server"
  retention_in_days = 7

  tags = {
    Project     = "pipe"
    Environment = var.environment
    ManagedBy   = "terraform"
  }
}
