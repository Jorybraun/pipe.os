# Pipe Demo Login Setup

This guide explains how to run Pipe in **demo mode** with test login credentials, with zero AWS account configuration required.

## Quick Start (TL;DR)

```bash
# 1. Install hooks (first time only)
bash scripts/install-hooks.sh

# 2. Terminal 1: Start local Amplify sandbox
npx ampx sandbox

# 3. Terminal 2: Start the app
npm run dev

# 4. Browser: Navigate to http://localhost:5173
# 5. Demo Credentials:
#    Email:    demo@pipe.test
#    Password: DemoPass123!
```

**Done.** You can now sign in and explore the full recruiter dashboard.

---

## Architecture Decisions

### Why Local Sandbox Instead of AWS?

| Approach | Pros | Cons | **Recommended** |
|---|---|---|---|
| **`npx ampx sandbox`** (local) | Zero AWS setup, fast, no costs | Local only, resets daily* | ✅ **For Development** |
| **AWS Account** (production) | Persistent, scalable, real environment | Setup required, costs | For deployment |

*Amplify sandbox persists for 30 days with daily auto-reset. See Amplify docs for `--no-scheduled-deletion` flag.

### Test Credentials Strategy

Pipe uses **email-based Cognito auth** with two user types:

1. **Recruiters** (signed-up users) — own pipelines, see candidate results
   - Demo user: `demo@pipe.test` / `DemoPass123!`
   - Data: owned by user via `allow.owner()` auth rule

2. **Candidates** (unauthenticated) — invited via `/assess/:token` URL
   - No login required — public invites with URL tokens
   - Handled by `allow.publicApiKey()` auth rules (guest access)

**Demo user flows:**
- ✅ Recruiter: sign in → create pipeline → see dashboard
- ✅ Candidate: click `/assess/TOKEN` → complete challenges → results auto-saved
- ✅ Recruiter (again): view candidate scores

---

## Setup Paths

### Path 1: Local Development (Recommended)

Use **`npx ampx sandbox`** — Amplify's local emulation of Cognito + DynamoDB + AppSync.

#### Requirements
- Node.js ≥18
- No AWS account needed
- ~200 MB disk space for local DynamoDB

#### Steps

1. **First time: Install git hooks**
   ```bash
   bash scripts/install-hooks.sh
   ```
   This enforces `CHANGELOG.md` updates on commits.

2. **Terminal 1: Start Amplify Sandbox**
   ```bash
   npx ampx sandbox
   ```
   
   **Output** (wait for this):
   ```
   ✅ Sandbox URLs:
     GraphQL endpoint: http://localhost:20002
     GraphQL API key: da123...
   ✅ Amplify sandbox is running. Press Ctrl+C to end.
   ```

3. **Terminal 2: Start Vite Dev Server**
   ```bash
   npm run dev
   ```
   
   **Output**:
   ```
   ✅ Local:   http://localhost:5173
   ```

4. **Browser: Visit http://localhost:5173**
   - You'll see the `<Authenticator>` login page
   - First-time visit: click "Create Account"
   - Enter test credentials:
     - **Email:** `demo@pipe.test`
     - **Password:** `DemoPass123!`
     - **Confirm:** `DemoPass123!`
   - ✅ Account created in local Cognito

5. **Dashboard Ready**
   - You're now signed in as a recruiter
   - Click "CREATE NEW PIPE" to build a pipeline
   - Create a 2-stage pipeline (e.g., "Senior Frontend Engineer")
   - Generate a candidate invite link
   - Share with test candidate or use `/assess/:token` directly in browser

#### Stopping / Restarting

```bash
# Ctrl+C to stop both sandbox and dev server

# Restart: both terminals
npx ampx sandbox   # Terminal 1
npm run dev        # Terminal 2
```

#### Local Sandbox Data Persistence

- **Duration:** 30 days (auto-resets daily at midnight UTC)
- **Survives:** Restarting dev server (Terminal 2 only)
- **Cleared on:** `npx ampx sandbox` restart (Terminal 1)
- **Reset early:** `rm -rf .amplify/local/`

---

### Path 2: AWS Account (Production Demo)

For persistent demo accessible to stakeholders, use a **real AWS environment**.

#### Requirements
- AWS Account (free tier eligible)
- AWS CLI configured: `aws configure`
- Amplify CLI: `npm install -g @aws-amplify/cli`

#### Steps

1. **Deploy Amplify Backend**
   ```bash
   npx ampx pipeline-deploy
   ```
   
   This creates a CloudFormation stack in your AWS account:
   - Cognito User Pool (for recruiter auth)
   - DynamoDB tables (pipelines, candidates, challenges, etc.)
   - AppSync GraphQL API
   - Lambda functions (agents, video relay, etc.)

   **Cost estimate:** ~$5–10/month for demo volume (Cognito: free tier; DynamoDB: pay-per-request)

2. **Fetch Outputs**
   ```bash
   npx ampx sandbox --outputs-version 5
   ```
   Updates `amplify_outputs.json` with your AWS environment details.

3. **Start Dev Server**
   ```bash
   npm run dev
   ```

4. **Sign Up Demo User**
   - Visit http://localhost:5173
   - Create account: `demo@pipe.test` / `DemoPass123!`
   - Credentials saved to Cognito User Pool in your AWS account
   - ✅ Persistent across restarts

5. **Share with Stakeholders**
   - Deploy frontend to Amplify Hosting or Vercel
   - Share URL (outside scope of this guide)
   - Stakeholders can sign in with demo credentials

---

## Environment Variables

### `.env.local` Reference

```bash
# Demo test credentials (DO NOT commit to git)
E2E_EMAIL=demo@pipe.test
E2E_PASSWORD=DemoPass123!

# Optional: Amplify verbose logging
VITE_AMPLIFY_DEBUG=false

# Optional: TURN server for video relay (required for production video)
VITE_METERED_API_KEY=<not-needed-for-local-demo>
```

### In `.gitignore` (already included)
- `.env.local` is ignored — safe to store credentials here locally

---

## Demo Workflows

### Workflow 1: End-to-End Recruiter + Candidate

1. **Sign in as Recruiter**
   ```
   Email: demo@pipe.test
   Password: DemoPass123!
   ```

2. **Create Pipeline**
   - Click "CREATE NEW PIPE"
   - Title: "Senior Frontend Engineer"
   - Create 2 stages: "Code Review" + "Technical Interview"
   - Add challenges to each stage (e.g., review buggy code)
   - Save pipeline

3. **Generate Candidate Invite**
   - Go to pipeline overview
   - Click "Share Invite" or copy `/assess/:TOKEN` link
   - (Note: Token generation is auto)

4. **View as Candidate**
   - Open new incognito window
   - Paste invite link
   - No login required — unauthenticated access
   - Complete challenges (code review, quiz, code challenge)
   - Submit — data saved to DynamoDB

5. **Return as Recruiter**
   - Refresh dashboard
   - Click candidate name
   - See per-challenge breakdown, scores, videos, code submissions

### Workflow 2: Scripted Data Seeding

To populate the demo with sample pipelines + candidates:

```bash
# Coming soon: npm run seed:demo
# (Not yet implemented — use manual workflow above for now)
```

---

## Troubleshooting

### Problem: "Failed to fetch" on localhost:5173

**Cause:** Amplify sandbox not running or stale outputs.

**Fix:**
```bash
# Terminal 1: Restart sandbox
npx ampx sandbox

# Terminal 2: Clear Vite cache and restart
rm -rf node_modules/.vite
npm run dev
```

### Problem: "User is not authenticated" after login

**Cause:** `amplify_outputs.json` is stale or missing Cognito config.

**Fix:**
```bash
# Regenerate outputs
npx ampx sandbox --outputs-version 5
# Then restart dev server
npm run dev
```

### Problem: "Cannot read property 'demo@pipe.test' of undefined"

**Cause:** Attempting to use production AWS credentials with local sandbox.

**Fix:**
```bash
# Unset AWS env vars for local dev
unset AWS_PROFILE AWS_ACCESS_KEY_ID AWS_SECRET_ACCESS_KEY

# Then restart sandbox
npx ampx sandbox
```

### Problem: "Cognito User Pool not found"

**Cause:** Wrong environment or sandbox deleted.

**Fix:**
```bash
# Full reset
rm -rf .amplify/local/
npx ampx sandbox
npm run dev
```

---

## Design System & Demo Data

### Challenge Types (Visible in Demo)

Create challenges of these types when building demo pipelines:

| Type | Component | Example |
|---|---|---|
| `CODE_REVIEW` | DiffReviewCanvas | Review buggy JavaScript |
| `QUIZ_MCQ` | QuizRenderer | Multiple choice questions |
| `QUIZ_SHORT_ANSWER` | TextareaPanel | Free-form text response |
| `CODE_IMPLEMENTATION` | MonacoPanel + Sandpack | Build React component |

### Sample Pipeline Template

Quick 3-stage pipeline to demo:

```
"Senior Full-Stack Engineer"
├─ Stage 1: Code Review (15 min)
│  └─ Challenge: Review buggy React hook (CODE_REVIEW)
├─ Stage 2: Quiz (10 min)
│  └─ Challenge: 5 MCQ on JavaScript (QUIZ_MCQ)
└─ Stage 3: Build Challenge (30 min)
   └─ Challenge: Implement React counter (CODE_IMPLEMENTATION, BUILD_COMPONENT)
```

---

## Commands Reference

```bash
# Development
npm run dev                    # Start Vite dev server
npx ampx sandbox              # Start Amplify sandbox (separate terminal)

# Build & Validate
npm run build                  # Production build
npx tsc --noEmit              # Type check

# Cleanup
rm -rf .amplify/local/         # Reset Amplify sandbox
rm -rf dist/                   # Remove build artifacts

# Production Deployment
npx ampx pipeline-deploy       # Deploy to AWS (CI only)
```

---

## Security Notes

**For demo purposes only:**
- ✅ Safe: Credentials in `.env.local` (not committed)
- ✅ Safe: Local sandbox (zero data persistence after 30 days)
- ⚠️ Avoid: Using production Cognito User Pool for demo
- ⚠️ Avoid: Sharing AWS credentials

**For production:**
- ❌ Never hardcode credentials
- ✅ Use AWS IAM roles for services
- ✅ Enable MFA for AWS account
- ✅ Set up Cost Alerts in AWS

---

## Next Steps

Once demo login is working:

1. **Seed Sample Data:** Follow `docs/ops/HANDOFF-data-cleanup.md` for production data
2. **Test Workflows:** Create test pipelines and invite actual candidates
3. **Deploy Frontend:** Host on Vercel, Netlify, or Amplify Hosting for sharing
4. **Review Documentation:** See `/docs/` for architecture, design system, and standards

---

## FAQ

**Q: Can I use demo credentials with production AWS?**  
A: No — production uses real Cognito. You'd sign up normally or create users via AWS Console.

**Q: How do I add a second demo user?**  
A: While signed in as `demo@pipe.test`, sign out → click "Create Account" → use different email.

**Q: Does the local sandbox persist between machine restarts?**  
A: No — sandbox data is cleared after 30 days or when `npx ampx sandbox` is restarted.

**Q: Can I migrate local sandbox data to production?**  
A: Not directly — you'd need to export from local DynamoDB and import to AWS. See `docs/ops/` for data scripts.

**Q: What if I want a fresh database?**  
A: 
```bash
rm -rf .amplify/local/
npx ampx sandbox
```

---

## Support

- **Amplify Docs:** https://docs.amplify.aws/
- **Cognito Auth:** https://docs.amplify.aws/react/build-a-backend/auth/
- **Local Sandbox:** https://docs.amplify.aws/gen2/deploy-and-host/sandbox/

---

**Last updated:** March 2026  
**Status:** ✅ Production Ready
