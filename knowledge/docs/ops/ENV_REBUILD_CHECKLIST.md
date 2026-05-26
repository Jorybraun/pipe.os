# Environment Variable Rebuild Checklist

> Rotated on: 2026-04-27
> Status: fill in the **New Value** column, then copy into the appropriate file.

---

## File Map

| File | Purpose | Who reads it |
|------|---------|--------------|
| `.env` | Root secrets (local scripts, agent-harness) | Python scripts, local tooling |
| `.env.local` | Frontend Vite vars + demo credentials | Browser (Vite) |
| `workers/api/.dev.vars` | Cloudflare Worker secrets (local dev) | `wrangler dev` |
| `workers/api/wrangler.jsonc` | Worker bindings & non-secret vars | Cloudflare platform |

---

## 1. Cloudflare Infrastructure

These are in **wrangler.jsonc bindings** — no secret rotation needed unless you provision new resources.

| Var | Type | Where it lives | Notes |
|-----|------|----------------|-------|
| `DB` / `pipe_db` | D1 binding | `wrangler.jsonc` | Database ID: `15afd1c5-640f-4ffc-b675-82d58c0eb548` |
| `STORAGE` | R2 binding | `wrangler.jsonc` | Bucket: `pipe-assets` |
| `REPO_INDEX` | Vectorize binding | `wrangler.jsonc` | Index: `repo-searchable-profiles` |
| `CANDIDATE_INDEX` | Vectorize binding | `wrangler.jsonc` | Index: `candidate-searchable-profiles` |
| `ROLE_INDEX` | Vectorize binding | `wrangler.jsonc` | Index: `role-searchable-profiles` |
| `AI` | Workers AI binding | `wrangler.jsonc` | Cloudflare AI gateway |
| `VIDEO_ROOM` | Durable Object | `wrangler.jsonc` | Video DO binding |
| `DEV_CONTAINER` | Durable Object | `wrangler.jsonc` | Dev container DO binding |
| `VOICE_SESSION` | Durable Object | `wrangler.jsonc` | Voice DO binding |

**Secrets for Cloudflare CLI / API:**

| Var | New Value | How to get it |
|-----|-----------|---------------|
| `CLOUDFLARE_ACCOUNT_ID` | | Dashboard → right sidebar "Account ID" |
| `CLOUDFLARE_API_TOKEN` | | My Profile → API Tokens → Create Token. Scopes: Cloudflare Workers Admin, D1 Edit, R2 Edit, Vectorize Edit |
| `CLOUDFLARE_D1_DATABASE_ID` | `15afd1c5-640f-4ffc-b675-82d58c0eb548` | `wrangler d1 list` or Dashboard → D1 |

---

## 2. Clerk Authentication

| Var | New Value | How to get it |
|-----|-----------|---------------|
| `CLERK_SECRET_KEY` | | Clerk Dashboard → API Keys → Secret key (starts with `sk_test_` or `sk_live_`) |
| `CLERK_PUBLISHABLE_KEY` | | Clerk Dashboard → API Keys → Publishable key (starts with `pk_test_` or `pk_live_`) |
| `VITE_CLERK_PUBLISHABLE_KEY` | *same as above* | Copy `CLERK_PUBLISHABLE_KEY` |

---

## 3. AI / LLM Providers

### Kimi (primary — agent harness + some workers)
| Var | New Value | How to get it |
|-----|-----------|---------------|
| `KIMI_API_KEY` | | Kimi Console → API Keys → Create key |
| `KIMI_BASE_URL` | `https://api.kimi.com/coding/v1` | Default; only change if using a proxy |
| `KIMI_MODEL` | `kimi-for-coding` | Default fallback model |
| `KIMI_STRATEGIC_MODEL` | `kimi-k2-6` | Or latest strategic model |
| `KIMI_DEV_MODEL` | `kimi-for-coding` | Dev/coding agent model |
| `KIMI_DEV_BASE_URL` | `https://api.kimi.com/coding/v1` | Dev agent base URL |
| `KIMI_ADVISOR_MODEL` | `kimi-k2-6` | Advisor agent override |
| `KIMI_ARCHITECT_MODEL` | `kimi-k2-6` | Architect agent override |
| `KIMI_ORCHESTRATOR_MODEL` | `kimi-k2-6` | Orchestrator agent override |
| `KIMI_META_PM_MODEL` | `kimi-k2-6` | Meta-PM agent override |
| `KIMI_QA_MODEL` | `kimi-k2-6` | QA agent override |
| `KIMI_CHAT_MODEL` | `kimi-k2-6` | Chat agent override |
| `KIMI_SUMMARIZER_MODEL` | | Summarizer model name |
| `KIMI_SUMMARIZER_MAX_TOKENS` | `4096` | Default is fine |

### OpenAI (fallback)
| Var | New Value | How to get it |
|-----|-----------|---------------|
| `OPENAI_API_KEY` | | OpenAI Platform → API Keys |

### Mistral (culture screening)
| Var | New Value | How to get it |
|-----|-----------|---------------|
| `MISTRAL_API_KEY` | | Mistral Console → API Keys |
| `MISTRAL_AGENT_ID` | | Mistral Console → Agents → copy Agent ID |

### Google / Vertex AI (issue scorer, live provider)
| Var | New Value | How to get it |
|-----|-----------|---------------|
| `GOOGLE_API_KEY` | | Google AI Studio → API Keys (or GCP Console) |
| `GOOGLE_AI_API_KEY` | *same as above* | Same key, different var name in workers |
| `VERTEX_API_KEY` | | GCP Console → IAM → Service Account Keys |
| `VERTEX_SA_KEY_JSON` | | Base64-encoded service account JSON key |
| `VERTEX_AI_PROJECT_ID` | | GCP project ID |
| `VERTEX_AI_REGION` | `us-central1` | Default region for Vertex AI |
| `VERTEX_AI_MODEL` | `gemini-2.0-flash` | Default model |
| `VERTEX_AI_LIVE_MODEL` | `gemini-2.0-flash-live` | Live/realtime model |

### Provider routing (workers)
| Var | New Value | How to get it |
|-----|-----------|---------------|
| `ROLE_AGENT_PROVIDER` | `vertex-ai` or `cloudflare-ai` | Set based on which provider you want for role scoring |
| `CULTURE_AGENT_PROVIDER` | `mistral` or `vertex-ai` | Culture screening provider |
| `CANDIDATE_AGENT_PROVIDER` | `vertex-ai` | Candidate matching provider |
| `COPILOT_AGENT_PROVIDER` | `vertex-ai` | Copilot provider |
| `LIVE_PROVIDER` | `vertex-ai` | Live/realtime provider |

---

## 4. GitHub

| Var | New Value | How to get it |
|-----|-----------|---------------|
| `GITHUB_TOKEN` | | GitHub Settings → Developer settings → Personal access tokens → Tokens (classic). Scopes: `repo` (private) or `public_repo` (public only) |
| `REPO_GIT_URL` | | Only needed for specific ingestion scripts; usually derived from repo metadata |

---

## 5. Communication / Outreach

### Twilio (voice / phone screening)
| Var | New Value | How to get it |
|-----|-----------|---------------|
| `TWILIO_ACCOUNT_SID` | | Twilio Console → Account Info |
| `TWILIO_AUTH_TOKEN` | | Twilio Console → Account Info (keep secret) |
| `TWILIO_API_KEY_SID` | | Twilio Console → API Keys → Create |
| `TWILIO_API_KEY_SECRET` | | Generated when you create the API key above |
| `TWILIO_PHONE_NUMBER` | | Twilio Console → Phone Numbers → Buy a number |
| `TWILIO_TWIML_APP_SID` | | Twilio Console → TwiML Apps → Create |

### Resend (email outreach)
| Var | New Value | How to get it |
|-----|-----------|---------------|
| `RESEND_API_KEY` | | Resend Dashboard → API Keys |

---

## 6. Scheduling OAuth

### Calendly
| Var | New Value | How to get it |
|-----|-----------|---------------|
| `CALENDLY_CLIENT_ID` | | Calendly Developer Portal → OAuth App |
| `CALENDLY_CLIENT_SECRET` | | Calendly Developer Portal → OAuth App |
| `VITE_CALENDLY_CLIENT_ID` | *same as above* | Copy client ID for frontend |

### Cal.com
| Var | New Value | How to get it |
|-----|-----------|---------------|
| `CALCOM_CLIENT_ID` | | Cal.com Settings → Developer → OAuth |
| `CALCOM_CLIENT_SECRET` | | Cal.com Settings → Developer → OAuth |
| `VITE_CALCOM_CLIENT_ID` | *same as above* | Copy client ID for frontend |

---

## 7. Google OAuth (candidate login / intake)

| Var | New Value | How to get it |
|-----|-----------|---------------|
| `GOOGLE_OAUTH_CLIENT_ID` | | Google Cloud Console → APIs & Services → Credentials → OAuth 2.0 Client IDs |
| `GOOGLE_OAUTH_CLIENT_SECRET` | | Same credentials page |

---

## 8. Internal Security Tokens (workers)

These live in `workers/api/.dev.vars` for local dev, and `wrangler secret put` for staging/prod.

| Var | New Value | How to get it |
|-----|-----------|---------------|
| `SESSION_TOKEN_SECRET` | `openssl rand -hex 32` | **Generate fresh** — rotating this invalidates all active candidate tokens |
| `CALIBRATE_TOKEN` | `openssl rand -hex 32` | **Generate fresh** — internal calibration API auth |
| `ADMIN_TTL_OVERRIDE_SECRET` | `openssl rand -hex 16` | **Generate fresh** — admin dev-container TTL override |
| `VOICE_SESSION_INTERNAL_SECRET` | `openssl rand -hex 32` | **Generate fresh** — voice session internal auth |

---

## 9. Frontend / Vite Variables (`.env.local`)

| Var | New Value | How to get it |
|-----|-----------|---------------|
| `VITE_API_URL` | `http://localhost:8787` | Local worker URL |
| `VITE_API_BASE_URL` | `http://localhost:8787` | Same as above (some code uses this alias) |
| `VITE_CLERK_PUBLISHABLE_KEY` | *same as Clerk key* | See Clerk section |
| `VITE_USE_CLOUDFLARE_DEV_CONTAINERS` | `false` | Feature flag; `true` to use Cloudflare dev containers |
| `VITE_FEATURE_INTELLIGENCE_REPORT` | `true` or `false` | Feature flag for intelligence report UI |
| `VITE_AMPLIFY_DEBUG` | `false` | Amplify debug logging |

### Demo Credentials (optional — local dev only)
| Var | New Value | How to get it |
|-----|-----------|---------------|
| `VITE_DEMO_EMAIL` | | Create a demo candidate in Clerk |
| `VITE_DEMO_PASSWORD` | | Set in Clerk |
| `E2E_EMAIL` | | Clerk test account email |
| `E2E_PASSWORD` | | Clerk test account password |

---

## 10. Agent Harness (`.env` or shell env)

The agent harness reads the same vars as the root `.env` plus model overrides.

Key vars it needs:
- `KIMI_API_KEY` (or `OPENAI_API_KEY` as fallback)
- `KIMI_BASE_URL`
- `KIMI_MODEL` / `KIMI_DEV_MODEL` / `KIMI_STRATEGIC_MODEL`
- `KIMI_DEV_BASE_URL`
- All the per-agent model overrides listed in section 3 above

---

## 11. Metered / TURN (video)

| Var | New Value | How to get it |
|-----|-----------|---------------|
| `METERED_API_KEY` | | Metered.ca Dashboard → API Keys |
| `VITE_METERED_API_KEY` | *same as above* | Copy for frontend |

---

## 12. Database (local dev only)

| Var | New Value | How to get it |
|-----|-----------|---------------|
| `DATABASE_URL` | | Local SQLite or PostgreSQL URL (used by some scripts, not the worker) |

---

## 13. Libraries.io (repo metadata enrichment)

| Var | New Value | How to get it |
|-----|-----------|---------------|
| `LIBRARIES_IO_API_KEY` | | Libraries.io → Account → API Key |

---

## 14. Microsoft OAuth (optional — if using Microsoft login)

| Var | New Value | How to get it |
|-----|-----------|---------------|
| `MICROSOFT_OAUTH_CLIENT_ID` | | Azure Portal → App registrations |
| `MICROSOFT_OAUTH_CLIENT_SECRET` | | Azure Portal → Certificates & secrets |

---

## 15. Dev Container Config (non-secrets)

These are in `wrangler.jsonc` under `vars` — no rotation needed.

| Var | Default | Notes |
|-----|---------|-------|
| `DEV_CONTAINER_DEFAULT_TTL_SECONDS` | `3600` | 1 hour default |
| `DEV_CONTAINER_MAX_TTL_SECONDS` | `7200` | 2 hour max |
| `DEV_CONTAINER_WARN_BEFORE_SECONDS` | `60` | Warning 1 min before expiry |
| `APP_BASE_URL` | `http://localhost:5173` | Frontend URL |

---

## 16. Feature Flags

| Var | New Value | Notes |
|-----|-----------|-------|
| `USE_STATIC_QUESTION_BANK` | `true` or `false` | Culture screening: use static question bank vs dynamic |
| `MOCK_AI` | `true` or `false` | Development only: mock LLM responses |

---

## Quick Generate Commands

```bash
# Generate secure random secrets
openssl rand -hex 32   # SESSION_TOKEN_SECRET, CALIBRATE_TOKEN, VOICE_SESSION_INTERNAL_SECRET
openssl rand -hex 16   # ADMIN_TTL_OVERRIDE_SECRET
```

---

## Next Steps

1. **Fill in the New Value column** above for every service you use.
2. **Write to `workers/api/.dev.vars`:**
   ```bash
   cat > workers/api/.dev.vars << 'EOF'
   SESSION_TOKEN_SECRET=...
   CALIBRATE_TOKEN=...
   ADMIN_TTL_OVERRIDE_SECRET=...
   VOICE_SESSION_INTERNAL_SECRET=...
   CLERK_SECRET_KEY=...
   GITHUB_TOKEN=...
   MISTRAL_API_KEY=...
   ANTHROPIC_API_KEY=...
   GOOGLE_AI_API_KEY=...
   VERTEX_SA_KEY_JSON=...
   VERTEX_AI_REGION=...
   VERTEX_AI_MODEL=...
   ROLE_AGENT_PROVIDER=...
   CULTURE_AGENT_PROVIDER=...
   COPILOT_AGENT_PROVIDER=...
   RESEND_API_KEY=...
   EOF
   ```
3. **Write to `.env`:** All root-level secrets (Clerk, GitHub, Cloudflare, Kimi, etc.)
4. **Write to `.env.local`:** All `VITE_*` frontend vars + demo credentials.
5. **Deploy secrets to Cloudflare:**
   ```bash
   cd workers/api
   for secret in SESSION_TOKEN_SECRET CALIBRATE_TOKEN ADMIN_TTL_OVERRIDE_SECRET VOICE_SESSION_INTERNAL_SECRET CLERK_SECRET_KEY GITHUB_TOKEN MISTRAL_API_KEY RESEND_API_KEY; do
     wrangler secret put $secret
   done
   ```
