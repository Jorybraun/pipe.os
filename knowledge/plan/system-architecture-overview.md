# PIPE System Architecture Overview

## 1. High-Level Components

```mermaid
graph TB
    subgraph Frontend["Frontend (React + Vite)"]
        Pages["Pages"]
        Hooks["Hooks"]
        Components["Components"]
    end

    subgraph Backend["Backend (Cloudflare Workers)"]
        Routes["API Routes"]
        Agents["Agent Modules"]
        LLM["LLM Providers"]
        DOs["Durable Objects"]
    end

    subgraph External["External Services"]
        Vertex["Vertex AI (Gemini)"]
        Kimi["Kimi k2.6"]
        D1["Cloudflare D1 (SQLite)"]
        Vectorize["Vectorize (embeddings)"]
    end

    Pages --> Hooks
    Hooks --> Routes
    Routes --> Agents
    Routes --> DOs
    Agents --> LLM
    LLM --> Vertex
    LLM --> Kimi
    Routes --> D1
    Agents --> D1
    DOs --> D1
    DOs --> Vertex
```

## 2. Role Discovery — Two Separate Paths

```mermaid
graph LR
    subgraph TextPath["Text Interview (HTTP Turn Loop)"]
        T1["useRoleDiscovery.ts"] --> T2["POST /state"]
        T2 --> T3["interviewReducer"]
        T3 --> T4["POST /question"]
        T4 --> T5["generateQuestionBatch"]
        T5 --> T6["LLM Call"]
    end

    subgraph VoicePath["Voice Interview (WebSocket Stream)"]
        V1["useLiveSession.ts"] --> V2["WSS /voice-sessions"]
        V2 --> V3["VoiceSessionDO"]
        V3 --> V4["VertexLiveProvider"]
        V4 --> V5["Vertex AI Gemini Live"]
    end

    T1 -. "shares state with" .-> AIChat
    V1 -. "shares state with" .-> AIChat
```

## 3. Text Interview — Detailed Flow

```mermaid
sequenceDiagram
    participant User
    participant AIChat
    participant useRD as useRoleDiscovery
    participant useConv as useConversation
    participant API as API Client
    participant State as /state endpoint
    participant Question as /question endpoint
    participant Reducer as interviewReducer
    participant Generator as generateQuestionBatch
    participant Provider as LLM Provider

    Note over User,Provider: Initialization
    User->>AIChat: Fill baseline form
    AIChat->>useRD: createAndStart(baseline)
    useRD->>API: POST /role-contexts
    API-->>useRD: { id, participantId }
    useRD->>API: POST /start
    API-->>useRD: { calibrationQuestion }
    useRD->>useConv: initialize()
    useConv->>AIChat: Show calibration question

    Note over User,Provider: Turn Loop (with Stack)
    User->>AIChat: Submit answer
    AIChat->>useConv: respond(answer, questionId)
    useConv->>useRD: adapter.respond()
    useRD->>API: POST /state { state, action: ANSWER }
    API->>Reducer: interviewReducer(state, action)
    Reducer-->>API: { newState }
    API-->>useRD: { state }
    useRD->>API: POST /question { state }

    alt Stack has questions
        Question-->>API: Pop from stack (instant)
    else Stack empty
        Question->>Generator: generateQuestionBatch(state, 3)
        Generator->>Provider: complete(messages)
        Provider-->>Generator: { batch: [q1, q2, q3] }
        Generator-->>Question: [GeneratedQuestion x3]
        Question-->>API: Return q1 + stack [q2, q3]
    end

    API-->>useRD: { question, acknowledgment, questionStack }
    useRD->>useConv: { type: 'question', ... }
    useConv->>AIChat: Show next question
```

## 4. Voice Interview — Detailed Flow

```mermaid
sequenceDiagram
    participant User
    participant AIChat
    participant Live as useLiveSession
    participant Worker as Cloudflare Worker
    participant DO as VoiceSessionDO
    participant Vertex as Vertex AI Gemini Live

    Note over User,Vertex: Setup (Sequential)
    User->>AIChat: Tap "Voice Interview"
    AIChat->>Worker: POST /voice-sessions { baseline }
    Worker->>Worker: buildVoiceSystemPrompt(baseline)
    Worker->>DO: POST /__init { systemPrompt }
    DO->>Vertex: openSession(systemPrompt)
    Vertex-->>DO: WebSocket connected
    DO-->>Worker: { status: 'ok' }
    Worker-->>AIChat: { sessionId }

    Note over User,Vertex: Connection
    AIChat->>Live: start(sessionId, token)
    Live->>Worker: WSS /voice-sessions/:id/ws
    Worker->>DO: WebSocket upgrade
    DO-->>Live: Connected
    Live->>Live: startMic() AudioWorklet

    Note over User,Vertex: Real-Time Bidirectional Stream
    loop Continuous
        Live->>Worker: audio frame (PCM16)
        Worker->>DO: sendAudio()
        DO->>Vertex: audio chunk
    end

    loop Continuous
        Vertex-->>DO: audio + transcript
        DO->>Worker: WS { audio, transcript }
        Worker-->>Live: onmessage()
        Live->>Live: enqueueAudio() playback
        Live->>AIChat: Update transcripts
    end

    Note over User,Vertex: Teardown
    User->>AIChat: End Session
    AIChat->>Live: stop()
    Live->>Worker: ws.close()
    Worker->>DO: close()
    DO->>Vertex: close()
    DO->>Worker: POST /transcript-callback
    Worker->>D1: Save transcript
```

## 5. Component Inventory

### Frontend Hooks

| Hook | Purpose | Used By |
|------|---------|---------|
| `useRoleDiscovery` | Manages text interview state + adapter | `RoleDiscoveryPage` |
| `useConversation` | Generic conversation state machine | `useRoleDiscovery` |
| `useLiveSession` | Real-time voice WebSocket + audio | `AIChat` (live mode) |
| `useApiClient` | HTTP client with auth | All hooks |

### Backend Routes

| Route | File | Purpose |
|-------|------|---------|
| `POST /role-contexts` | `roleContexts.ts` | Create interview |
| `POST /start` | `roleContexts.ts` | Return calibration question |
| `POST /state` | `roleContexts.ts` | Run reducer |
| `POST /question` | `roleContexts.ts` | Generate next question (now with stack) |
| `POST /synthesize` | `roleContexts.ts` | Generate persona + JD |
| `POST /voice-sessions` | `voiceSessions.ts` | Create voice session |
| `GET /voice-sessions/:id/ws` | `voiceSessions.ts` | WebSocket upgrade |

### Backend Agents

| Agent | File | Used By |
|-------|------|---------|
| `interviewReducer` | `interview/reducer.ts` | `/state` endpoint |
| `generateQuestion` | `question/generator.ts` | `/question` SSE path |
| `generateQuestionBatch` | `question/generator.ts` | `/question` non-streaming path |
| `evaluateQuestion` | `question/eval.ts` | `/question` (disabled) |
| `synthesize` | `synthesis/generator.ts` | `/synthesize` endpoint |
| `callRoleAgent` | `roleAgent.ts` | `/respond` (legacy, still active) |

### Durable Objects

| DO | File | Purpose |
|----|------|---------|
| `VoiceSessionDO` | `VoiceSessionDO.ts` | Real-time voice proxy |

### LLM Providers

| Provider | File | Used By |
|----------|------|---------|
| `VertexAIProvider` | `vertexAIProvider.ts` | `generateQuestionBatch`, `synthesize` |
| `KimiProvider` | `kimiProvider.ts` | Fallback |
| `VertexLiveProvider` | `live/vertexLiveProvider.ts` | `VoiceSessionDO` |

## 6. What Uses What — Matrix

```mermaid
graph TB
    subgraph Text["Text Interview"]
        T_RD["useRoleDiscovery"]
        T_State["/state"]
        T_Q["/question"]
        T_Reducer["interviewReducer"]
        T_Gen["generateQuestionBatch"]
        T_Vertex["VertexAIProvider"]
    end

    subgraph Voice["Voice Interview"]
        V_Live["useLiveSession"]
        V_WS["WSS /voice-sessions"]
        V_DO["VoiceSessionDO"]
        V_LiveProv["VertexLiveProvider"]
        V_Vertex["Vertex AI Live"]
    end

    subgraph Legacy["Legacy (Still Active)"]
        L_Respond["/respond"]
        L_Agent["callRoleAgent"]
        L_Prompts["roleAgentPrompts"]
    end

    T_RD --> T_State
    T_RD --> T_Q
    T_State --> T_Reducer
    T_Q --> T_Gen
    T_Gen --> T_Vertex

    V_Live --> V_WS
    V_WS --> V_DO
    V_DO --> V_LiveProv
    V_LiveProv --> V_Vertex

    L_Respond --> L_Agent
    L_Agent --> L_Prompts
    L_Agent --> T_Vertex
```

## 7. Key Architectural Facts

1. **Two interviews, zero shared code at runtime**
   - Text path: HTTP request/response, state machine, question stack
   - Voice path: WebSocket stream, single prompt, model-managed flow

2. **Legacy `/respond` is still active**
   - The old monolithic `callRoleAgent` handles the streaming path in `/respond`
   - The new state machine (`/state` + `/question`) handles the non-streaming path
   - Both exist simultaneously

3. **Voice agent has no stack**
   - The voice agent sends a single system prompt to Vertex AI and lets the model generate all questions internally
   - It cannot use the question stack because Vertex Live does not support structured JSON output or prompt replacement mid-session

4. **The question stack only helps text**
   - Batch generates 3 questions per LLM call
   - Serves questions 2 and 3 instantly (no LLM latency)
   - Reduces per-turn latency from ~7s to ~13ms for stacked questions
