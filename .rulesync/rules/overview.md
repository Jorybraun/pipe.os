---
name: Pipe Platform Overview
targets: ["*"]
description: "Project mission, tech stack, architecture overview, and development workflow"
globs: []
alwaysApply: false
---

# Pipe Platform Overview

## Project Identity

**Project:** Pipe - AI-Native Developer Interview Platform
**Repository:** pipe-os
**Version:** 0.0.0 (Initial Development)

## Mission

Build better engineering teams by evaluating how developers actually work today with AI tools, reflecting the modern reality of software development.

## Core Value Proposition

Traditional coding interviews are broken. AI tools can trivially solve standard algorithm questions, making them meaningless. Pipe evaluates the skills that matter:

- Asking thoughtful clarifying questions
- Using AI strategically for well-defined subtasks
- Critically reviewing and improving AI-generated code
- Demonstrating strong debugging skills when AI solutions have issues

## Tech Stack

### Frontend

- **Framework:** React 18.2 with Vite 5.4
- **Language:** TypeScript 5.4 (strict mode)
- **Build Tool:** Vite with ESBuild
- **Component Development:** Storybook 10.1

### Backend/Infrastructure

- **Platform:** AWS Amplify Gen 2
- **Authentication:** Amazon Cognito (via Amplify Auth)
- **API:** GraphQL with AWS AppSync (via Amplify Data)
- **Database:** Amazon DynamoDB
- **Storage:** Amazon S3 (via Amplify Storage)
- **Infrastructure as Code:** AWS CDK (via Amplify)

### UI/Design

- **Component Library:** @aws-amplify/ui-react 6.5
- **Visual Effects:** @paper-design/shaders-react 0.0.68

### Testing

- **Unit Testing:** Vitest 4.0 (via Storybook addon)
- **Component Testing:** Storybook + Vitest browser mode
- **E2E Testing:** Playwright 1.57
- **Coverage:** @vitest/coverage-v8

### Development Tools

- **Linting:** ESLint 8.57 with TypeScript plugins
- **Documentation Sync:** rulesync 3.12.3

## Project Structure

```
pipe-os/
├── amplify/                    # AWS Amplify Gen 2 backend
│   ├── backend.ts              # Main backend definition
│   ├── auth/
│   │   └── resource.ts         # Cognito authentication config
│   ├── data/
│   │   └── resource.ts         # AppSync/DynamoDB data config
│   ├── package.json
│   └── tsconfig.json
├── src/                        # Vite + React application
│   ├── App.tsx                 # Main application component
│   ├── main.tsx                # Application entry point
│   ├── App.css
│   ├── index.css
│   └── assets/
├── prototypes/                 # UI prototypes (React JSX/TSX)
│   ├── brutalist-glasomorphic-profile.jsx
│   ├── candidate-screening.jsx
│   ├── listing-page.jsx
│   ├── overview-prototype.jsx
│   ├── pipeline-builder.jsx
│   ├── profile-example.tsx
│   └── screening-stage-builder.jsx
├── stories/                    # Storybook stories
│   └── *.stories.tsx
├── .rulesync/                  # Agent configuration
│   ├── rules-v3/               # Coding standards and patterns
│   ├── commands-v3/            # Agent command definitions
│   ├── subagents-v3/           # Agent persona definitions
│   └── templates-v3/           # Document templates
├── package.json
├── tsconfig.json
├── vite.config.ts
└── README.md
```

## Key Features

- **AI-Native Assessment:** Evaluates AI collaboration skills, not just coding
- **Agentic Pipeline Builder:** AI generates interview content, humans refine
- **Multi-Stage Pipelines:** Code review, voice interviews, planning assessments
- **Comprehensive Profiling:** AI-generated candidate profiles with evidence
- **Real-World Simulation:** Mirrors actual development workflows

## Development Workflow

### Local Development

```bash
# Install dependencies
npm install

# Start development server
npm run dev

# Run Storybook for component development
npm run storybook

# Run linting
npm run lint

# Build for production
npm run build
```

### AWS Amplify Sandbox

```bash
# Start Amplify sandbox (per-developer cloud environment)
npx ampx sandbox

# Deploy to production
npx ampx pipeline-deploy
```

## Best Practices Summary

1. **Amplify Gen 2 Patterns:** Use TypeScript-first backend definitions
2. **React 18 Patterns:** Leverage concurrent features, proper hooks usage
3. **Type Safety:** Strict TypeScript, no `any` types
4. **Component Development:** Build and test components in Storybook first
5. **Testing:** Vitest for unit tests, Playwright for E2E
6. **Documentation:** Self-documenting code with JSDoc comments
