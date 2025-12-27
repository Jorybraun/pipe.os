# Pipe — AI-Native Developer Interview Platform

> Build better engineering teams by evaluating how developers actually work today.

## Overview

Pipe is an AI-native developer interview platform that embraces and evaluates how developers work with AI tools—reflecting the modern reality of software development. Unlike traditional platforms that prevent AI use, Pipe assesses candidates' ability to leverage AI effectively.

## Why Pipe?

Traditional coding interviews are broken. AI tools can trivially solve standard algorithm questions, making them meaningless. The most successful developers today don't just write code—they:

- Ask thoughtful clarifying questions
- Use AI strategically for well-defined subtasks
- Critically review and improve AI-generated code
- Demonstrate strong debugging skills when AI solutions have issues

Pipe evaluates these real-world skills.

## Key Features

- **AI-Native Assessment**: Evaluates AI collaboration skills, not just coding
- **Agentic Pipeline Builder**: AI generates interview content, humans refine
- **Multi-Stage Pipelines**: Code review, voice interviews, planning assessments
- **Comprehensive Profiling**: AI-generated candidate profiles with evidence
- **Real-World Simulation**: Mirrors actual development workflows


## Project Structure

```
pipe-os/
├── amplify/           # AWS Amplify backend (auth, data, infra)
│   ├── backend.ts
│   ├── auth/
│   │   └── resource.ts
│   ├── data/
│   │   └── resource.ts
│   ├── package.json
│   └── tsconfig.json
├── prototypes/        # UI prototypes (React JSX/TSX)
│   ├── brutalist-glasomorphic-profile.jsx
│   ├── candidate-screening.jsx
│   ├── listing-page.jsx
│   ├── overview-prototype.jsx
│   ├── pipeline-builder.jsx
│   ├── profile-example.tsx
│   └── screening-stage-builder.jsx
├── public/            # Static assets
├── src/               # App source (Vite+React)
│   ├── App.tsx
│   ├── main.tsx
│   ├── App.css
│   ├── index.css
│   ├── vite-env.d.ts
│   └── assets/
├── package.json
├── tsconfig.json
├── vite.config.ts
├── README.md
└── ... (other config/docs)
```

## Documentation Status


## Tech Stack

- **Frontend**: React 18, Vite, TypeScript, CSS Modules
- **Prototyping**: React (JSX/TSX) in `/prototypes`
- **Backend/Infra**: AWS Amplify (with Cognito, AppSync, DynamoDB, S3)
- **Infrastructure as Code**: AWS CDK, Amplify CLI
- **Linting/Formatting**: ESLint, TypeScript strict mode

## Getting Started

This repository currently contains documentation and prototypes. Implementation is tracked via the task breakdown in each feature's UI-REQUIREMENTS.md.

### View Prototypes

The prototypes are React components. To view them:

1. Copy the prototype JSX into a React project, or
2. Use an online React playground (CodeSandbox, StackBlitz)

### Read Documentation

Start with:

1. [Business Requirements](./docs/business-requirements.md)
2. [Pipeline Creation Epic](./docs/epics/pipeline-creation/EPIC.md)
3. [Code Review Stage](./docs/epics/pipeline-creation/interview-stages/code-review/) (most complete)

## Contributing

See the task breakdown in `docs/epics/pipeline-creation/interview-stages/code-review/UI-REQUIREMENTS.md` for implementation tasks formatted for Claude Code.

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
