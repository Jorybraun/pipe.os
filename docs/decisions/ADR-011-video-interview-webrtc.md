# ADR-011: WebRTC + AppSync Signaling for Live Video Interviews

**Date:** 2026-02-28
**Status:** Proposed
**Deciders:** Jory (solo founder)

---

## Context

Pipe needs a live video interview stage where a recruiter and candidate can join a real-time video call while the candidate works through challenges. The system needs to work within the existing AWS Amplify Gen 2 stack and remain cost-effective for a solo-founder product.

The key engineering choices are:
1. Which video infrastructure to use
2. How to signal between the two parties (required for WebRTC peer connection setup)
3. How to handle NAT traversal (TURN server)

---

## Decision

Use **browser-native WebRTC** (`RTCPeerConnection`) for media, **AppSync real-time subscriptions** as the signaling channel, and **Metered.ca** for TURN server infrastructure.

---

## Options Considered

### Option A: Amazon IVS (Interactive Video Service) — Managed
Amazon's live streaming service. Supports low-latency broadcast and real-time communication.

**Pros:**
- Fully managed — no TURN/STUN to operate
- Native AWS integration
- Scales to many viewers

**Cons:**
- Broadcast model (one-to-many), not peer-to-peer — requires a stage setup
- $0.002/participant-minute + $0.0085/GB ingest — ~$1.50/hour for a 1:1 interview
- IVS Real-Time adds another pricing tier ($0.01/participant-minute)
- Doesn't fit the "phone call" UX model naturally
- Adds a significant managed service dependency

**Verdict:** Too expensive for 1:1 interviews. IVS is designed for broadcast, not bilateral conversation.

### Option B: Daily.co — Managed WebRTC Platform
Fully managed WebRTC-as-a-service with React SDK.

**Pros:**
- Excellent DX, React hooks API, prebuilt UI components
- Recording, transcription, TURN all managed
- Very fast to build

**Cons:**
- $0.004/participant-minute (~$2.40/hour for a 1:1 call) — expensive at scale
- All video/audio flows through Daily.co servers (data processor relationship)
- Vendor lock-in to a third party's infrastructure and SDK
- Adds a third-party data processor (candidate video data leaves your stack)

**Verdict:** Best developer experience but too expensive and creates a data processor relationship that adds compliance complexity.

### Option C: Twilio Video — Managed WebRTC
Similar managed offering from Twilio.

**Pros:**
- Battle-tested, reliable
- Recording, transcription included

**Cons:**
- ~$0.004/participant-minute, significantly more expensive than Daily.co
- Twilio has had reliability issues at scale
- Same vendor lock-in and data processor concerns as Daily.co

**Verdict:** More expensive than Daily.co with no significant advantages for this use case.

### Option D: Browser-Native WebRTC + AppSync Signaling + Metered.ca TURN (CHOSEN)

Raw WebRTC (`RTCPeerConnection`) with:
- AppSync GraphQL subscriptions as the signaling channel (already in stack)
- Google STUN servers (free) for STUN
- Metered.ca for TURN (managed TURN relay, ~$0.40/GB, free tier 1 GB/month)

**Pros:**
- Media flows peer-to-peer (TURN relay only for ~20% of connections behind strict NAT)
- No third-party data processor for video/audio — media stays off your servers
- TURN cost is negligible at interview scale (~$0.40/GB; a 1-hour video call is ~500MB total = ~$0.20)
- Signaling uses AppSync which is already in the stack (zero new infra for signaling)
- Full control over UX without framework constraints
- No per-minute pricing model

**Cons:**
- More implementation work than a managed SDK (must implement offer/answer/ICE exchange)
- Must operate TURN infrastructure (Metered.ca is managed TURN, so minimal ops)
- Browser compatibility must be handled (WebRTC is supported in all modern browsers)
- Must handle reconnection and ICE restart logic

**Verdict:** Best long-term choice. Lower ongoing cost, no vendor dependency, no data processor relationship, fits the Amplify-first stack.

---

## Decision Rationale

The primary reasons for choosing Option D:

1. **Cost structure:** At interview volume, peer-to-peer WebRTC costs ~$0.20/call in TURN relay costs vs. ~$2.40/call with a managed service. At 1,000 interviews, that's $200 vs. $2,400.

2. **No data processor relationship:** Candidate video/audio never leaves the AWS environment (TURN relay is infrastructure, not a data processor). Managed services like Daily.co and Twilio Video become data processors, adding GDPR/compliance obligations.

3. **AppSync signaling is free:** Signaling messages (SDP offers/answers, ICE candidates) are tiny JSON documents exchanged via existing AppSync subscriptions. This reuses existing infrastructure with no additional cost.

4. **Metered.ca TURN is low-ops:** Unlike self-hosted Coturn on EC2, Metered.ca provides managed TURN with a REST API for temporary credentials. Fits the solo-founder ops model.

5. **Full UX control:** The phone-call-style UX (waiting room → call initiated → accept → connected) requires precise control over state transitions that is easier to implement with raw WebRTC than adapting a managed SDK's UX model.

---

## Consequences

### What this requires

- Implementing `useVideoSession` hook with full WebRTC peer connection lifecycle
- Implementing `useVideoSignaling` hook for AppSync subscription-based signaling
- A `videoCredentials` Lambda to fetch temporary TURN credentials from Metered.ca
- New `VideoSession` and `VideoSignal` DynamoDB models
- A `VideoShell` component that composes outside the existing `TimerShell` + `WorkspaceLayout`
- `Stage.mode` field (`ASYNC | LIVE_VIDEO`) and `Stage.videoConfig` JSON field

### What this avoids

- No new managed video service subscription
- No SDK dependency that could change pricing or APIs
- No third-party data processor for candidate PII (video)
- No TURN server to operate (Metered.ca handles it)

### Known risks

- **Browser compatibility:** WebRTC is supported in all major browsers (Chrome, Firefox, Safari 11+, Edge). IE is not supported — not relevant for this use case.
- **TURN server availability:** Metered.ca has SLA-based uptime. A fallback would be a second TURN provider (e.g., add Twilio NRTS `urls` to the ICE server config array).
- **Signaling latency:** AppSync subscriptions have ~100ms delivery latency. This is acceptable for signaling (not media). ICE negotiation tolerates 200–500ms signaling latency.
- **Implementation complexity:** WebRTC negotiation (especially ICE restart on reconnect) is non-trivial. Budget implementation time accordingly.

---

## Implementation Notes

Full design: `docs/design/video-interview-architecture.md`

Signaling data model: `VideoSession` + `VideoSignal` models in `amplify/data/resource.ts`

TURN credentials Lambda: `amplify/functions/videoCredentials/handler.ts`

Required Amplify secret: `METERED_API_KEY` (set via `npx ampx sandbox secret set METERED_API_KEY`)

Component entry point: `src/components/Shells/VideoShell.tsx`
