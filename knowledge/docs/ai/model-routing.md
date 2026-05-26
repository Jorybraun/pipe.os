---
status: current
answers: "Which AI model handles which task in Pipe"
owner: workers/api/src/lib/llm/createProvider.ts
see_also: [knowledge/STRATEGY.md, docs/decisions/current/ADR-032-code-review-research-integration.md]
---

# AI Model Routing

There is no single LLM. Different agents use different models so each task picks the cheapest option that's still strong enough. All routing lives in `workers/api/src/lib/llm/createProvider.ts`.

See `knowledge/outputs/code-review-content-sourcing.md` Part 3.6 for the research-grounded rationale and `knowledge/STRATEGY.md` CR-12.

## Routing Table

| Agent / job | Primary model | Provider | Why |
|---|---|---|---|
| Culture interview agent (turn FSM, scoring) | `gemma-4-26b-a4b-it` | Vertex AI (prod) / Workers AI (fallback) | Strong instruction-following + structured JSON output. Runs on Vertex MaaS in prod (per-token, no daily cap); Workers AI binding is the fallback. |
| Culture scorer (5 dimensions × 5 axes + synthesis) | `gemma-4-26b-a4b-it` | Vertex AI (prod) / Workers AI (fallback) | 11 calls per scoring run; Vertex per-token pricing keeps cost predictable without burning Workers AI neurons. |
| Role Discovery agent (persona + JD synthesis) | `gemma-4-26b-a4b-it` | Vertex AI (prod) / Workers AI (fallback) | Migrated off Mistral Small. Vertex AI MaaS endpoint via `ROLE_AGENT_PROVIDER=vertex-ai` for production throughput; `cloudflare-ai` binding is the code default and the fallback. Same Gemma 4 26B model on both paths — only the provider differs. 31B dense is not yet on MaaS (per `vertexAIProvider.ts`). |
| **Role Discovery consistency classifier (NEW, per ADR-038)** — runs every agent turn | `@cf/qwen/qwen3-30b-a3b-fp8` | **Workers AI** | **Non-negotiable guardrail against off-topic / fatigue / sensitivity drift. Cross-family from Gemma-on-Vertex primary (Panickssery 2024). MoE with 3B active params + FP8 quant → fast enough for per-turn guard; edge binding keeps latency low.** |
| Code review implementer agent (junior/mid persona) | Qwen 2.5-Coder 32B | Workers AI | Coder-tuned model handles diff understanding + rebuttals well. |
| Code review implementer agent (senior persona, premium tier) | Qwen3-Coder (when avail) / Claude Sonnet 4.6 fallback | Workers AI / Anthropic | Senior persona needs stronger reasoning to hold nuanced pushback in-character (research: CR-6, CR-12) |
| **Code review consistency classifier (NEW, per ADR-032)** — runs on every implementer turn | **Gemma 4 (12B if avail on Vertex MaaS, else 26B)** | **Vertex AI (prod) / Workers AI (fallback)** | **Non-negotiable guardrail against agent drift (14–34% off-persona baseline per research). 4-axis JSON classifier. MUST be a different model family than the Qwen implementer it guards (Panickssery cross-family principle).** |
| Code review scoring panel (production, 6 dimensions per ADR-032) | Devstral Small | Mistral | Specialized evaluative model; runs the per-PR scoring in the Worker. |
| **Scoring gold-standard oracle (NEW, per ADR-032)** — offline calibration | **Claude Sonnet 4.6** (via Agent tool) | **Anthropic** | **Offline κ measurement against Devstral; target ≥ 0.75; escalate Devstral dimension to Sonnet live if κ < 0.70 (research: CR-10).** |
| **Content pipeline — bug templates (NEW, per ADR-032)** — ~20 templates, lifetime | **Claude Opus 4.6** (via Agent tool) | **Anthropic** | **Highest-leverage content artifact; spend premium tokens once per template.** |
| **Content pipeline — variant generation (NEW)** — batch, offline | **Claude Sonnet 4.6** (via Agent tool) | **Anthropic** | **Quality-sensitive, cost-insensitive, offline.** |
| Content pipeline — item tagging | Claude Haiku 4.5 (via Agent tool) | Anthropic | Matches existing "build-time bulk tagging" pattern; offline, bulk. |
| Emergency fallback (any agent) | Claude Sonnet 4.6 | Anthropic | Used only when the primary provider is down. Cost gate enforced. |

## Routing Principles (locked in, per research)

1. **Never use the same model family for agent and its consistency classifier.** Gemma-guarding-Qwen (code review) and Qwen-guarding-Gemma (role discovery) are independent perspectives; same-family judging is useless (Panickssery 2024).
2. **Always keep a ceiling model distinct from production scoring.** Devstral for live scoring; Sonnet 4.6 as offline oracle. Track κ drift.
3. **Gemma always runs on Vertex AI MaaS in production, with the Workers AI binding as fallback.** Role Discovery, culture interview agent, culture scorer, and the (planned) code-review consistency classifier all route Gemma 4 through `VertexAIProvider` — per-token pricing, no daily cap. Qwen Coder (implementer), Qwen3-30b-a3b-fp8 (role-discovery classifier), Whisper, and BGE embeddings stay on Workers AI — they're not available on Vertex MaaS and edge-binding latency is fine for their profile. Content generation, tagging, and calibration always run offline via the Anthropic Agent tool path.

## Quotas to Remember

- **Workers AI** has a free-tier neurons/day ceiling — with Gemma moved to Vertex, the remaining Workers AI load is Qwen Coder (code-review implementer), Qwen3-30b-a3b-fp8 (role-discovery classifier), Whisper, and BGE embeddings. Monitor neuron spend; promote any hot-path Qwen to Vertex only if a Vertex MaaS endpoint exists for the model (Qwen3 MoE is not currently on Vertex MaaS per `vertexAIProvider.ts`).
- **Vertex AI Gemma 4** is metered per-token — no daily cap. Track spend in `culture_usage_tracking` and equivalent tables for role discovery.
- **Mistral Devstral** is metered per-token; budget tracked in `culture_usage_tracking` and `culture_compliance_audit`.
- **Build-time bulk tagging** (e.g. wiki sync) uses Haiku 4.5 via the Agent tool, never Gemma.

## Build-time vs Runtime

Workers cannot read the filesystem. Anything that needs to ship to the Worker (question banks, role overlays, calibration fixtures) must be bundled as a TS const via a sync script (see `workers/api/scripts/sync-culture-wiki.ts`).
