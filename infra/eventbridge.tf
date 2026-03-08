# EventBridge rule to trigger ecsStatusBridge Lambda on ECS task state changes
# This enables automatic ALB registration when dev containers reach RUNNING state

resource "aws_cloudwatch_event_rule" "ecs_task_state_change" {
  name        = "pipe-${var.environment}-ecs-task-state-change"
  description = "Routes ECS Task State Change events to ecsStatusBridge Lambda"

  event_pattern = jsonencode({
    source      = ["aws.ecs"]
    detail-type = ["ECS Task State Change"]
  })

  tags = {
    Project     = "pipe"
    Environment = var.environment
    ManagedBy   = "terraform"
  }
}

# Lambda permission for EventBridge to invoke ecsStatusBridge
# Note: Lambda function is managed by Amplify, we only add the permission
resource "aws_lambda_permission" "allow_eventbridge" {
  statement_id  = "AllowExecutionFromEventBridge"
  action        = "lambda:InvokeFunction"
  function_name = "data-ecsStatusBridge-lambda"  # Amplify-managed function
  principal     = "events.amazonaws.com"
  source_arn    = aws_cloudwatch_event_rule.ecs_task_state_change.arn
}

# EventBridge target pointing to the Amplify-managed Lambda
resource "aws_cloudwatch_event_target" "ecs_status_bridge" {
  rule      = aws_cloudwatch_event_rule.ecs_task_state_change.name
  target_id = "EcsStatusBridgeLambda"
  arn       = "arn:aws:lambda:${var.aws_region}:${data.aws_caller_identity.current.account_id}:function:data-ecsStatusBridge-lambda"
}

data "aws_caller_identity" "current" {}
