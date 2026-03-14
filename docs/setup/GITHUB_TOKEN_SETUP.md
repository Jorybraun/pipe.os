# GitHub Token Setup

## Why We Need It

The GitHub PR integration (Stream 3) fetches pull request data from GitHub's API to create CODE_REVIEW challenges. This requires authentication.

## Rate Limits

| Auth Method | Requests/Hour |
|-------------|---------------|
| No token | 60 |
| With token | 5,000 |

For production use, **a token is required**.

## How to Get a GitHub Personal Access Token (PAT)

1. Go to: **https://github.com/settings/tokens**
2. Click: **"Generate new token (classic)"**
3. Give it a name: `Pipe Platform PR Fetcher`
4. Select scopes:
   - **`repo`** (if you need private repos)
   - OR **`public_repo`** (if you only use public repos)
5. Click: **"Generate token"**
6. **Copy the token** — you won't see it again!

## How to Add It to Your Project

### For Local Development

Add to `./.env` in the repo root:

```bash
GITHUB_TOKEN=ghp_your_token_here
```

**This file is gitignored** — the token won't be committed.

### For Production (AWS)

The Lambda checks two places (in order):
1. **`GITHUB_TOKEN` env var** (local dev)
2. **AWS Secrets Manager** (production)

To add to AWS Secrets Manager:

```bash
aws secretsmanager create-secret \
  --name pipe-github-pr-integration \
  --secret-string '{"token":"ghp_YOUR_TOKEN_HERE"}' \
  --region us-east-1
```

**OR** via AWS Console:
1. Go to **AWS Secrets Manager**
2. Create secret
3. Name: `pipe-github-pr-integration`
4. Value: `{"token":"ghp_YOUR_TOKEN_HERE"}`

## How to Test It

Once you've added the token:

```bash
cd <repo-root>

# Start Amplify sandbox (loads .env automatically)
npx ampx sandbox

# Test the Lambda (in another terminal)
# This will call the fetchGitHubPR Lambda
# You should see in logs: "Using token from GITHUB_TOKEN env var"
```

## Security Notes

- `.env` is gitignored — tokens won't be committed
- Lambda logs **never** print the token value
- Token is only used server-side (Lambdas), never exposed to browser
- Token has minimal scopes (only repo read access)
- Rotate tokens periodically (GitHub Settings > Tokens > Regenerate)

## What If I Don't Have a Token?

The Lambda will fail with:
```
GITHUB_AUTH_ERROR: Could not load GitHub token from Secrets Manager or env var
```

You can either:
1. **Add the token** (recommended)
2. **Make token optional** and accept rate limits (not recommended for production)

## Files Modified

- `amplify/functions/fetchGitHubPR/handler.ts` — Reads `GITHUB_TOKEN` env var first, falls back to Secrets Manager
- `.env` — Add `GITHUB_TOKEN=` here (gitignored)
- `.env.example` — Documents all required env vars
