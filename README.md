# Pipe — AI-Native Developer Interview Platform

> Build better engineering teams by evaluating how developers actually work today.

## Project Outline

### Architecture Overview

**Interview Container (Core Innovation)**
```
Single Container Per Interview:
├── GitLab CE Server (lightweight git server)
├── Pre-seeded Challenge Repos (from pipe-scaffold)
├── VS Code Server (web-based IDE)
├── AI Tools (Copilot, Amazon Q, etc.)
├── Development Environment (Node, Python, etc.)
└── Session Monitor (captures all activity)
```

**Real Git Workflow:**
1. Container spawns with GitLab server + challenge repos
2. Candidate clones, branches, commits, pushes normally
3. Creates merge requests, reviews code in GitLab UI
4. All git history preserved in GitLab database
5. Container destroyed, GitLab data exported for evaluation

### Core Components
- **Interview Engine**: Containerized development environments
- **Evaluation System**: Automated assessment of code quality, AI usage patterns, and problem-solving approach
- **Candidate Portal**: Authentication, interview scheduling, and progress tracking
- **Interviewer Dashboard**: Live monitoring, custom scenarios, and detailed analytics

### Technical Stack
- **Frontend**: React + Vite (this scaffold) - candidate/interviewer web interface
- **Backend**: AWS Amplify with GraphQL API for real-time data
- **Database**: DynamoDB for scalable candidate and session storage
- **Authentication**: Cognito for secure multi-role access
- **Infrastructure**: ECS Fargate for interview containers + serverless web platform

### Why This Scaffold?
This React app provides:
- **Candidate Portal**: Schedule interviews, join sessions, view results
- **Interviewer Dashboard**: Monitor live sessions, review evaluations
- **Container Orchestration**: Spawn/manage interview environments
- **Session Management**: Real-time streaming of container activity

### Challenge Generation
The `pipe-scaffold/` CLI tool generates realistic coding scenarios:
- **Templates**: StoreFront, DevHub, TeamChat (production-like apps)
- **Variants**: Composable frontend features (routing, state, styling)
- **Challenge Types**: Code review (find bugs) + Implementation (build features)
- **Output**: Docker containers with full-stack apps + AI agent access

## Overview

Pipe is an developer interview platform that embraces and evaluates how developers work with AI tools—reflecting the modern reality of software development. Pipe creates a real world scenario to test developers in.

## License

Private - All Rights Reserved

## AWS Amplify React+Vite Starter Template

This repository provides a starter template for creating applications using React+Vite and AWS Amplify, emphasizing easy setup for authentication, API, and database capabilities.

## Overview

This template equips you with a foundational React application integrated with AWS Amplify, streamlined for scalability and performance. It is ideal for developers looking to jumpstart their project with pre-configured AWS services like Cognito, AppSync, and DynamoDB.

## Features

- **Authentication**: Setup with Amazon Cognito for secure user authentication.
- **API**: Ready-to-use GraphQL endpoint with AWS AppSync.
- **Database**: Real-time database powered by Amazon DynamoDB.

## Deploying to AWS

For detailed instructions on deploying your application, refer to the [deployment section](https://docs.amplify.aws/react/start/quickstart/#deploy-a-fullstack-app-to-aws) of our documentation.

## Security

See [CONTRIBUTING](CONTRIBUTING.md#security-issue-notifications) for more information.

## License

This library is licensed under the MIT-0 License. See the LICENSE file.
