# Adding Environment Variables to AWS Amplify

## Overview

Amplify Gen 2 has two types of environment variables:

| Type | Prefix | Usage | Where to Set |
|------|--------|-------|--------------|
| **Build-time** | `VITE_*` | Frontend config, baked into bundle | `.env` file (picked up during `npm run build`) |
| **Lambda secrets** | None | Server-side only, never exposed to browser | `npx ampx sandbox secret set` |

## Current Secrets

Your `.env` file (in the repo root, gitignored) should contain:

```bash
# Lambda Secrets (server-side only)
METERED_API_KEY=your_metered_api_key_here
CALENDLY_CLIENT_ID=your_calendly_client_id_here
CALENDLY_CLIENT_SECRET=your_calendly_client_secret_here
CALCOM_CLIENT_ID=
CALCOM_CLIENT_SECRET=
GITHUB_TOKEN=ghp_your_github_token_here

# Build-time variables (client-side, public)
VITE_CALENDLY_CLIENT_ID=your_calendly_client_id_here
VITE_CALCOM_CLIENT_ID=
```

## Method 1: Automated Script (Recommended)

Run the helper script to set all secrets at once:

```bash
cd <repo-root>
bash scripts/set-amplify-secrets.sh
```

This will:
1. Read all non-VITE variables from `.env`
2. Show you what will be set
3. Ask for confirmation
4. Set each secret via `npx ampx sandbox secret set`

## Method 2: Manual Setup

Set each secret individually:

```bash
cd <repo-root>

# Metered API (for WebRTC TURN credentials)
npx ampx sandbox secret set METERED_API_KEY "your_metered_api_key_here"

# Calendly OAuth
npx ampx sandbox secret set CALENDLY_CLIENT_ID "your_calendly_client_id_here"
npx ampx sandbox secret set CALENDLY_CLIENT_SECRET "your_calendly_client_secret_here"

# Cal.com OAuth (currently empty, set when you have credentials)
# npx ampx sandbox secret set CALCOM_CLIENT_ID "your_calcom_id"
# npx ampx sandbox secret set CALCOM_CLIENT_SECRET "your_calcom_secret"

# GitHub Token (for CODE_REVIEW challenges)
npx ampx sandbox secret set GITHUB_TOKEN "ghp_your_github_token_here"
```

## Verify Secrets

List all secrets that have been set:

```bash
npx ampx sandbox secret list
```

Output should show:
```
METERED_API_KEY
CALENDLY_CLIENT_ID
CALENDLY_CLIENT_SECRET
GITHUB_TOKEN
```

## How Secrets Work

### In Code

Lambdas access secrets via `process.env`:

```typescript
// amplify/functions/schedulingOAuth/resource.ts
import { defineFunction, secret } from '@aws-amplify/backend';

export const schedulingOAuth = defineFunction({
  name: 'schedulingOAuth',
  environment: {
    CALENDLY_CLIENT_ID: secret('CALENDLY_CLIENT_ID'),
    CALENDLY_CLIENT_SECRET: secret('CALENDLY_CLIENT_SECRET'),
  },
});

// amplify/functions/schedulingOAuth/handler.ts
const clientId = process.env.CALENDLY_CLIENT_ID;  // Accessed at runtime
```

### Where They Live

| Environment | Storage | How to Set |
|-------------|---------|------------|
| **Local Sandbox** | `~/.amplify/secrets/<sandbox-id>` | `npx ampx sandbox secret set` |
| **Deployed Branch** | AWS Secrets Manager | Amplify Console |
| **Production** | AWS Secrets Manager | Amplify Console |

### Security

- Secrets are **encrypted at rest** in AWS Secrets Manager
- Secrets are **never logged** or exposed in CloudWatch
- Secrets are **injected at runtime** into Lambda environment
- `.env` file is **gitignored** — never committed
- Anyone with AWS console access can view secrets
- Rotate tokens periodically

## Build-Time Variables (VITE_*)

These are **different** — they're baked into the frontend bundle during build:

```bash
# These go in .env and are picked up by Vite during npm run build
VITE_CALENDLY_CLIENT_ID=your_calendly_client_id_here
VITE_CALCOM_CLIENT_ID=your_id
```

**Important:**
- Do NOT use for secrets (they end up in the browser bundle)
- Use for public config (API endpoints, feature flags, public IDs)
- Accessed in frontend code via: `import.meta.env.VITE_CALENDLY_CLIENT_ID`

## After Setting Secrets

1. **Restart Amplify sandbox:**
   ```bash
   # Kill existing sandbox
   pkill -f "ampx sandbox" || killall node

   # Start fresh
   cd <repo-root>
   npx ampx sandbox
   ```

2. **Verify in Lambda logs:**
   - Look for: `[getGitHubToken] Using token from GITHUB_TOKEN env var`
   - Should **NOT** see: `GitHub token not configured`

3. **Test the Lambda:**
   - Create a CODE_REVIEW challenge
   - Enter a GitHub repo + PR number
   - Should fetch PR successfully

## Troubleshooting

### "Secret not found"
```bash
# Check what's set
npx ampx sandbox secret list

# Re-set the missing secret
npx ampx sandbox secret set SECRET_NAME "value"
```

### "Permission denied" on secrets
```bash
# Check AWS profile
aws sts get-caller-identity

# Make sure you're using the right profile
npx ampx sandbox --profile default
```

### Secrets not loading in Lambda
```bash
# Restart sandbox (picks up new secrets)
pkill -f "ampx sandbox"
npx ampx sandbox
```

### Want to change a secret
```bash
# Just set it again (overwrites)
npx ampx sandbox secret set GITHUB_TOKEN "new_token_here"

# Restart sandbox
pkill -f "ampx sandbox" && npx ampx sandbox
```

### Want to remove a secret
```bash
npx ampx sandbox secret remove SECRET_NAME
```

## Production Deployment

When deploying to production, you need to set secrets in the **Amplify Console**:

1. Go to: AWS Console > Amplify > Your App
2. Click: **App Settings** > **Environment Variables**
3. Add each secret with its production value:
   - `METERED_API_KEY`
   - `CALENDLY_CLIENT_ID`
   - `CALENDLY_CLIENT_SECRET`
   - `GITHUB_TOKEN`
4. Click: **Save**
5. Redeploy the app

**Note:** For production, generate **new tokens** (not reuse dev tokens) for better security.

## Summary

```bash
# Quick setup (from scratch)
cd <repo-root>

# Set each secret
npx ampx sandbox secret set METERED_API_KEY "your_value"
npx ampx sandbox secret set CALENDLY_CLIENT_ID "your_value"
npx ampx sandbox secret set CALENDLY_CLIENT_SECRET "your_value"
npx ampx sandbox secret set GITHUB_TOKEN "ghp_your_token"

# Verify
npx ampx sandbox secret list

# Start sandbox
npx ampx sandbox
```
