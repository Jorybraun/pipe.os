# Pipe — Cost Per Candidate Estimate

Last updated: 2026-03-27

---

## Model pipeline: "Senior Frontend Engineer"

Assumes a single stage with 4 challenges + 1 AI-generated follow-up, which is the standard pipeline shape described in the MVP definition.

| Step | Challenge | What fires | Mistral calls | Lambda | DynamoDB |
|------|-----------|-----------|---------------|--------|----------|
| 1 | QUIZ_MCQ | deterministic `===` | 0 | ~50ms @ 256MB | 3 reads, 1 write |
| 1b | — follow-up gen | Mistral: generate 5 Qs | **1** | ~8s @ 512MB | 1 read, 1 write |
| 2 | CODE_IMPL (backend) | `node:vm` test runner | 0 | ~5s @ 1GB | 3 reads, 1 write |
| 2b | — follow-up gen | Mistral: generate 5 Qs | **1** | ~8s @ 512MB | 1 read, 1 write |
| 3 | CODE_REVIEW | deterministic bug-match | 0 | ~100ms @ 256MB | 3 reads, 1 write |
| 3b | — follow-up gen | Mistral: generate 5 Qs | **1** | ~8s @ 512MB | 1 read, 1 write |
| 3c | — follow-up scored | Mistral: agentic score | **1** | ~12s @ 512MB | 2 reads, 1 write |
| 4 | CODE_IMPL (frontend) | `jsdom` test runner | 0 | ~8s @ 1GB | 3 reads, 1 write |
| 4b | — follow-up gen | Mistral: generate 5 Qs | **1** | ~8s @ 512MB | 1 read, 1 write |
| — | getStageConfig | DynamoDB lookups | 0 | ~200ms @ 256MB | ~6 reads, 2 writes |
| — | getChallenge x4 | DynamoDB lookups | 0 | ~100ms x4 @ 256MB | ~4 reads x4 |

**Total Mistral calls per candidate: 5**

---

## Cost breakdown per candidate

### Mistral API (mistral-large-latest)

Pricing: Input $3/M tokens, Output $9/M tokens.

| Call | Input tokens | Output tokens | Input cost | Output cost | Total |
|------|-------------|---------------|------------|-------------|-------|
| Follow-up gen (MCQ) | ~1,000 | ~600 | $0.003 | $0.005 | **$0.008** |
| Follow-up gen (CODE_IMPL) | ~1,500 | ~600 | $0.005 | $0.005 | **$0.010** |
| Follow-up gen (CODE_REVIEW) | ~1,750 | ~600 | $0.005 | $0.005 | **$0.010** |
| Agentic score (CODE_REVIEW) | ~2,100 | ~512 | $0.006 | $0.005 | **$0.011** |
| Follow-up gen (CODE_IMPL #2) | ~1,500 | ~600 | $0.005 | $0.005 | **$0.010** |
| **Mistral total** | **~7,850** | **~2,912** | **$0.024** | **$0.025** | **$0.049** |

### AWS Lambda

Pricing: $0.0000166667 per GB-second.

| Invocations | Total GB-seconds | Cost |
|-------------|-----------------|------|
| 5 follow-up/scoring @ 512MB, ~8s avg | ~20 GB-s | $0.0003 |
| 2 code execution @ 1GB, ~6s avg | ~12 GB-s | $0.0002 |
| 8 utility Lambdas @ 256MB, ~0.2s avg | ~0.4 GB-s | $0.000007 |
| **Lambda total** | **~32 GB-s** | **$0.0005** |

### DynamoDB (on-demand)

Pricing: $1.25 per million read units, $1.25 per million write units.

| Operation | Units | Cost |
|-----------|-------|------|
| ~30 reads (scans + gets) | ~60 RCU | $0.000075 |
| ~10 writes (puts + updates) | ~10 WCU | $0.0000125 |
| **DynamoDB total** | | **$0.0001** |

---

## Total cost per candidate

| Component | Cost | % of total |
|-----------|------|-----------|
| **Mistral API** | $0.049 | **98.8%** |
| Lambda compute | $0.0005 | 1.0% |
| DynamoDB | $0.0001 | 0.2% |
| **Total** | **~$0.05** | |

---

## At scale

| Candidates/month | Mistral | Lambda | DynamoDB | Total | Monthly |
|-------------------|---------|--------|----------|-------|---------|
| 10 | $0.49 | $0.01 | $0.00 | $0.50 | Free tier covers most |
| 100 | $4.90 | $0.05 | $0.01 | **$5** | |
| 1,000 | $49 | $0.50 | $0.10 | **$50** | |
| 10,000 | $490 | $5 | $1 | **$496** | |
| 50,000 | $2,450 | $25 | $5 | **$2,480** | |

---

## Cost reduction opportunities

### 1. Switch follow-up generation to a smaller model (HIGH IMPACT)

Follow-up question generation doesn't need `mistral-large`. The task is formulaic — generate 5 probing questions given a submission. A smaller model works fine here.

| Model | Input $/M | Output $/M | Per-call cost | Savings vs large |
|-------|-----------|------------|---------------|-----------------|
| mistral-large-latest | $3.00 | $9.00 | ~$0.010 | baseline |
| mistral-small-latest | $0.20 | $0.60 | ~$0.001 | **90%** |
| mistral-nemo (open) | $0.15 | $0.15 | ~$0.0003 | **97%** |

**Impact**: Follow-up gen is 4 of 5 Mistral calls. Switching to `mistral-small` for follow-up gen while keeping `mistral-large` for agentic scoring drops per-candidate cost from **$0.05 to ~$0.015**.

### 2. Skip follow-ups for MCQ and simple challenges (MEDIUM IMPACT)

MCQ is a binary right/wrong answer. Generating follow-up questions for it adds $0.008 per candidate for questionable value. Same argument for simple short-answer.

**Impact**: Remove 1-2 follow-up gen calls. Saves **$0.008-$0.016** per candidate.

### 3. Make follow-ups opt-in per challenge (MEDIUM IMPACT)

The `enableFollowUp` config flag already exists but follow-up generation currently fires for all types. Respect it strictly — only generate follow-ups when the recruiter explicitly enables them.

**Impact**: Recruiter controls cost per pipeline. A pipeline with follow-ups on only CODE_REVIEW would cost ~$0.02 per candidate instead of $0.05.

### 4. Cache agentic scoring prompts (LOW IMPACT)

The system prompt for agentic scoring is ~630 tokens and identical every time. Mistral supports prompt caching — repeated system prompts are charged at reduced rates.

**Impact**: Saves ~$0.002 per scoring call. Marginal.

### 5. Replace Mistral with self-hosted model (HIGH IMPACT, HIGH EFFORT)

At 50K candidates/month ($2,450/mo), it becomes viable to run a fine-tuned open model on a dedicated GPU instance (~$500/mo for an A10G).

**Impact**: Cuts Mistral cost to near-zero. Only makes sense at very high volume.

---

## Recommended immediate changes

| Change | Effort | Monthly savings @ 1K candidates |
|--------|--------|------|
| Smaller model for follow-up gen | 1 env var change | $36 (~72%) |
| Skip follow-ups for MCQ | 5 lines of code | $8 (~16%) |
| Respect `enableFollowUp` flag | Already wired | Variable |
| **Combined** | **30 min work** | **~$40 (80%)** |

This takes per-candidate cost from **$0.05 to ~$0.01**.
