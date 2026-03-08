# Lambda IAM Policies for CloudWatch Logs Access
# These policies are attached to Amplify-managed Lambda roles to grant
# CloudWatch Logs permissions that Amplify CDK isn't reliably applying.

# Policy for getContainerLogs Lambda
resource "aws_iam_policy" "get_container_logs_policy" {
  name        = "pipe-get-container-logs-policy"
  description = "Allows getContainerLogs Lambda to read CloudWatch Logs"

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect = "Allow"
        Action = [
          "logs:FilterLogEvents",
          "logs:DescribeLogStreams"
        ]
        Resource = "arn:aws:logs:*:*:log-group:/pipe/dev-containers/code-server"
      }
    ]
  })
}

# Attach policy to the Lambda role
# Note: The role name is dynamic (created by Amplify), so we use a data source
data "aws_iam_role" "get_container_logs_role" {
  name = "amplify-amplifyvitereactt-getContainerLogslambdaSer-vlkd3enAthfr"
}

resource "aws_iam_role_policy_attachment" "get_container_logs_attachment" {
  role       = data.aws_iam_role.get_container_logs_role.name
  policy_arn = aws_iam_policy.get_container_logs_policy.arn
}
