# Role Discovery Interview Flow — Diagrams

---

## 1. Current Production Architecture

```mermaid
flowchart TB
    subgraph Frontend["Frontend"]
        A["Candidate fills baseline form"]
        B["AIChat Component"]
        C["useRoleDiscovery Hook"]
    end

    subgraph Backend["Backend — POST /:id/respond"]
        D["Reconstruct InterviewState from D1"]
        E["interviewReducer(state, ANSWER)"]
        F["Check synthesisReady (STALE)"]
        G["Domain Orchestrator"]
        H["Generate Domain Questions (LLM)"]
        I["Serve Cached Question"]
        J["runRcdSynthesis (LLM)"]
        K["Persist to D1"]
    end

    subgraph Storage["Storage"]
        L[("D1 — role_contexts")]
        M[("D1 — role_context_participants")]
    end

    subgraph LLM["LLM Provider"]
        N["Vertex AI / Cloudflare / Kimi"]
    end

    A --> B
    B --> C
    C -->|"POST /respond {answer}"| D
    D --> M
    D --> L
    D --> E
    E --> F
    F -->|"if true (rarely)"| J
    F -->|"usually false"| G
    G -->|"cache empty"| H
    G -->|"cache hit"| I
    H --> N
    I --> K
    H --> K
    J --> N
    J --> K
    K --> M
    K --> L
    K -->|"question payload"| C
    K -->|"synthesis payload"| C
    C --> B
```

---

## 2. Complete Interview Lifecycle — From Start to Finish

```mermaid
sequenceDiagram
    autonumber
    actor U as Hiring Manager
    participant F as Frontend (React)
    participant API as Backend API
    participant D1 as D1 Database
    participant Neo4j as Neo4j Graph
    participant Vec as Vectorize
    participant LLM as LLM Provider

    Note over U,LLM: Phase 1 — Interview Creation

    U->>F: Fill baseline form<br/>Title, company, salary, tech stack
    F->>API: POST /api/v1/role-contexts
    API->>D1: INSERT role_contexts<br/>{ baseline, status: 'draft' }
    API->>D1: INSERT role_context_participants<br/>{ role_context_id, creator, status: 'active' }
    D1-->>API: { roleContextId, participantId }
    API-->>F: { id, participantId }
    F->>U: Show "Start Interview" button

    Note over U,LLM: Phase 2 — Interview Start

    U->>F: Click "Start Interview"
    F->>API: POST /:id/start
    API->>API: Return hardcoded calibration question
    API-->>F: { question: "Tell me about this role..." }
    F->>U: Display calibration question

    Note over U,LLM: Phase 3 — Turn Loop (6 Domains)

    loop Domain: team (4-6 questions)
        U->>F: Submit answer
        F->>API: POST /:id/respond { answer, questionId }
        API->>D1: SELECT role_contexts + role_context_participants
        D1-->>API: exchanges, knowledge_state, baseline
        API->>API: reconstructInterviewStateFromDb()
        API->>API: interviewReducer(state, ANSWER)
        API->>API: domainOrchestrator.getNextDomainDrivenQuestion()

        alt First question in domain
            API->>LLM: generateDomainQuestions('team', state)
            LLM-->>API: [q1, q2, q3, q4, q5, q6]
            API->>API: Cache in state.domainQuestions
        end

        API->>API: Pop next cached question
        API->>D1: persistQuestionTurn()
        D1-->>API: OK
        API-->>F: { question, acknowledgment }
        F->>U: Show next question
    end

    loop Domain: work (4-6 questions)
        U->>F: Submit answer
        F->>API: POST /:id/respond { answer }
        API->>API: Same flow as above
        API-->>F: Next question
        F->>U: Show question
    end

    loop Domain: bar (4-6 questions)
        U->>F: Submit answer
        F->>API: POST /:id/respond { answer }
        API-->>F: Next question
        F->>U: Show question
    end

    loop Domain: codebase (4-6 questions)
        U->>F: Submit answer
        F->>API: POST /:id/respond { answer }
        API-->>F: Next question
        F->>U: Show question
    end

    loop Domain: process (4-6 questions)
        U->>F: Submit answer
        F->>API: POST /:id/respond { answer }
        API-->>F: Next question
        F->>U: Show question
    end

    loop Domain: why (4-6 questions)
        U->>F: Submit answer
        F->>API: POST /:id/respond { answer }
        API-->>F: Next question
        F->>U: Show question
    end

    Note over U,LLM: Phase 4 — Synthesis (All Domains Complete)

    U->>F: Submit final answer
    F->>API: POST /:id/respond { answer }
    API->>API: domainOrchestrator → all domains complete
    API->>API: runRcdSynthesis()
    API->>D1: SELECT ALL participants for this role context
    D1-->>API: All transcripts + knowledge states

    API->>LLM: synthesizeRcd(allTranscripts)
    LLM-->>API: RCD JSON<br/>{ domain_matrix, conflicts, technical_context, ... }

    API->>D1: UPDATE role_contexts SET rcd_json = ...
    API->>API: decomposeRcdIntoNodes()
    API->>Neo4j: CREATE role nodes + relationships
    API->>API: buildAndStoreRoleEmbedding()
    API->>Vec: UPSERT embedding vector

    API->>D1: UPDATE role_context_participants SET status = 'completed'
    API-->>F: { type: 'synthesis', persona, jobDescription, rcd }
    F->>U: Show persona card + JD preview

    Note over U,LLM: Phase 5 — Optional: Add More Stakeholders

    alt Add team member
        U->>F: Invite team member
        F->>API: POST /:id/invite { email }
        API->>D1: INSERT new participant
        Note over U,LLM: Repeat Phase 2-4 for new participant
    end

    Note over U,LLM: Phase 6 — Pipeline Link

    U->>F: Link to pipeline
    F->>API: PATCH /:id { pipelineId }
    API->>D1: UPDATE role_contexts SET pipeline_id = ...
    API-->>F: OK
    F->>U: Role context linked to pipeline
```

---

## 3. The /respond Turn Loop (Sequence Diagram)

```mermaid
sequenceDiagram
    autonumber
    participant U as User
    participant F as Frontend
    participant R as POST /:id/respond
    participant D as D1 Database
    participant Red as interviewReducer
    participant Orc as domainOrchestrator
    participant Gen as domainGenerator
    participant Synth as runRcdSynthesis
    participant LLM as LLM Provider

    Note over U,LLM: Turn Loop — Each User Answer

    U->>F: Submit answer
    F->>R: POST /respond {answer, questionId}

    R->>D: SELECT role_contexts
    R->>D: SELECT role_context_participants
    D-->>R: exchanges, knowledge_state, baseline

    R->>R: reconstructInterviewStateFromDb()
    Note right of R: Computes coverage,<br/>phase, questionsAsked<br/>from DB JSON blobs

    R->>Red: interviewReducer(state, ANSWER)
    Note right of Red: Appends answer,<br/>increments counter,<br/>updates domain counts.<br/>NO phase recomputation.
    Red-->>R: partialState

    R->>R: Check state.synthesisReady
    Note right of R: This is STALE —<br/>set during reconstruction,<br/>not updated by reducer

    alt synthesisReady = true (edge case)
        R->>Synth: runRcdSynthesis()
        Synth->>D: Read ALL participants
        D-->>Synth: All transcripts
        Synth->>LLM: synthesizeRcd()
        LLM-->>Synth: RCD JSON
        Synth->>D: Persist RCD + decompose nodes
        Synth-->>R: {persona, jobDescription, rcd}
        R-->>F: synthesis payload
    else Normal turn
        R->>Orc: getNextDomainDrivenQuestion(state, provider)

        alt Cache miss
            Orc->>Gen: generateDomainQuestions(domain, state)
            Gen->>LLM: complete(prompt)
            LLM-->>Gen: [q1, q2, q3, q4, q5, q6]
            Gen-->>Orc: questions array
            Orc->>Orc: Cache in state.domainQuestions
        else Cache hit
            Orc->>Orc: Pop next question from cache
        end

        Orc-->>R: nextQuestion
        R->>D: persistQuestionTurn()
        D-->>R: OK
        R-->>F: question payload
    end

    F->>U: Show next question or synthesis
```

---

## 4. Domain Orchestrator — The Real State Machine

```mermaid
flowchart TD
    Start(["User submits answer"]) --> Reconstruct["Reconstruct InterviewState"]
    Reconstruct --> Reduce["interviewReducer: ANSWER"]
    Reduce --> CheckDomain{"Current domain complete?"}

    CheckDomain -->|"No — need next question"| CheckCache{"Questions cached?"}
    CheckCache -->|"Yes"| ServeQ["Serve next cached question"]
    CheckCache -->|"No"| GenBatch["generateDomainQuestions()<br/>LLM call — batch of 6"]
    GenBatch --> Cache["Cache in state.domainQuestions"]
    Cache --> ServeQ
    ServeQ --> PersistQ["persistQuestionTurn()"]
    PersistQ --> ReturnQ["Return question payload"]
    ReturnQ --> EndQ(["User sees question"])

    CheckDomain -->|"Yes — domain done"| Advance{"More domains?"}

    Advance -->|"Yes"| NextDomain["Advance to next domain<br/>team → work → bar → codebase → process → why"]
    NextDomain --> GenBatch

    Advance -->|"No — all domains done"| Synth["runRcdSynthesis()<br/>Multi-stakeholder LLM call"]
    Synth --> PersistS["persistSynthesisTurn()<br/>RCD + Neo4j nodes + embedding"]
    PersistS --> ReturnS["Return synthesis payload"]
    ReturnS --> EndS(["User sees persona + JD"])

    CheckDomain -->|"Thin answer"| FollowUp["Serve warm follow-up"]
    FollowUp --> PersistQ
```

---

## 5. State Reconstruction from Database

```mermaid
flowchart LR
    subgraph DB["D1 Tables"]
        RC["role_contexts<br/>• baseline<br/>• rcd_json<br/>• config"]
        RP["role_context_participants<br/>• exchanges []<br/>• knowledge_state {}<br/>• status<br/>• updated_at"]
    end

    subgraph Reconstruct["reconstructInterviewStateFromDb()"]
        A["Parse exchanges JSON"]
        B["Parse knowledge_state JSON"]
        C["readDomainCoverage()"]
        D["readEvpCoverage()"]
        E["readStories()"]
        F["readProbesDelivered()"]
        G["readSoulProbesDelivered()"]
        H["selectPhase()"]
        I["Assemble InterviewState"]
    end

    subgraph State["InterviewState"]
        S1["exchanges"]
        S2["knowledgeState"]
        S3["coverage"]
        S4["phase"]
        S5["questionsAsked"]
        S6["synthesisReady"]
        S7["currentDomain"]
        S8["domainCompletion"]
        S9["domainQuestions"]
    end

    RC --> A
    RP --> B
    B --> C
    B --> D
    B --> E
    B --> F
    B --> G
    C --> H
    D --> H
    E --> H
    F --> H
    G --> H
    A --> I
    B --> I
    H --> I
    I --> S1
    I --> S2
    I --> S3
    I --> S4
    I --> S5
    I --> S6
    I --> S7
    I --> S8
    I --> S9
```

---

## 6. UAR — Complete Interview Lifecycle (Proposed, Never Implemented)

```mermaid
sequenceDiagram
    autonumber
    actor R as Recruiter
    actor C as Candidate
    participant FE as Frontend
    participant API as Backend (agents.ts)
    participant Store as InMemorySessionStore
    participant FSM as createFSM(config)
    participant Plugin as roleDiscoveryPlugin
    participant Eval as runEvalGate()
    participant Score as scoreSession()
    participant Prov as callProvider()
    participant LLM as LLM Provider

    Note over R,LLM: Phase 1 — Session Creation

    R->>FE: Create role discovery interview
    FE->>API: POST /api/v1/agents/role_discovery/sessions<br/>{ challengeId, candidateId }
    API->>Store: createSession('role_discovery', challengeId, candidateId)
    Store->>Store: Generate ID: `${Date.now().toString(36)}_${Math.random()}`
    Store->>Store: state = 'consent'<br/>transcript = { turns: [], scratchpad: {} }
    Store-->>API: { id, agentType, state }
    API-->>FE: { sessionId, state: 'consent' }
    FE-->>R: Show "Send Invite" link

    Note over R,LLM: Phase 2 — Candidate Access

    R->>C: Send invite link with token<br/>(token = raw session ID)
    C->>FE: Open /assess/:token
    FE->>API: GET /rpc/agents/:token
    API->>Store: getSessionByToken(token)
    Store-->>API: { state: 'consent', transcript: {...} }
    API-->>FE: { state: 'consent', turnCount: 0, nextQuestion: null }
    FE->>C: Show consent screen

    Note over R,LLM: Phase 3 — Consent

    C->>FE: Click "I consent"
    FE->>API: POST /rpc/agents/:token/consent
    API->>Store: getSessionByToken(token)
    API->>FSM: fsm.nextState(session)<br/>(consent + consentAt → in_progress)
    API->>Store: updateSession(id, { state: 'in_progress' })
    API->>Plugin: plugin.generateTurn(session, {}, provider)
    Plugin->>Prov: callProvider(messages, { forceJson: true })
    Prov->>LLM: complete(prompt)
    LLM-->>Prov: { content: questionJSON }
    Prov-->>Plugin: { content, usage }
    Plugin-->>API: { idx: 0, questionText: '...', metadata: {...} }
    API->>Store: appendTurn(id, turn)
    API-->>FE: { state: 'in_progress', turn: turn }
    FE->>C: Show first question

    Note over R,LLM: Phase 4 — Turn Loop

    loop Each Answer (up to maxRounds)
        C->>FE: Submit answer
        FE->>API: POST /rpc/agents/:token/respond<br/>{ answer: '...' }

        API->>Store: getSessionByToken(token)
        Store-->>API: session

        API->>FSM: fsm.nextState(session)
        FSM-->>API: nextState

        alt nextState === 'scoring'
            API->>Score: scoreSession(provider, session, plugin.scoringConfig)
            Score->>Prov: Run dimension prompts in parallel
            Prov->>LLM: complete(dimensionPrompt)
            LLM-->>Prov: dimensionScore
            Prov-->>Score: scores
            Score-->>API: { dimensions, narrative, recommendation }

            API->>Store: updateSession(id, {<br/>state: 'complete',<br/>scoreReport: report<br/>})
            API-->>FE: { state: 'complete', report }
            FE->>C: Show "Interview Complete"
            Note over C: LOOP ENDS

        else nextState === 'in_progress'
            API->>Plugin: plugin.generateTurn(session, {}, provider)
            Plugin->>Prov: callProvider(messages, { forceJson: true })
            Prov->>LLM: complete(prompt)
            LLM-->>Prov: { content }
            Prov-->>Plugin: { content }
            Plugin-->>API: turn

            alt plugin.evalConfig exists
                API->>Eval: runEvalGate(provider, turn, session, plugin.evalConfig)
                Eval->>Prov: Run eval dimensions in parallel
                Prov->>LLM: complete(evalPrompt)
                LLM-->>Prov: evalResult
                Prov-->>Eval: results
                Eval-->>API: { approved: true/false, rewrite? }

                alt !approved && rewrite
                    API->>API: turn.questionText = rewrite
                end
            end

            API->>Store: appendTurn(id, turn)
            API-->>FE: { state: 'in_progress', turn }
            FE->>C: Show next question
        end
    end

    Note over R,LLM: Phase 5 — Recruiter Views Report

    R->>FE: Open candidate profile
    FE->>API: GET /api/v1/agents/role_discovery/sessions/:id/report
    API->>Store: getSession(id)
    Store-->>API: { state: 'complete', scoreReport: {...} }
    API-->>FE: { state: 'complete', report }
    FE->>R: Show score dimensions + narrative

    Note over R,LLM: Phase 6 — Recruiter HITL Override (Optional)

    R->>FE: Override dimension score
    FE->>API: POST /api/v1/agents/role_discovery/sessions/:id/review<br/>{ overrides: [{ dimensionId, score }] }
    API->>Store: getSession(id)
    API->>API: Apply overrides to scoreReport
    API->>Store: updateSession(id, { scoreReport: updated })
    API-->>FE: { report: updated }
```

### Key Differences from Current Production

| Aspect | UAR (Proposed) | Current Production |
|--------|---------------|-------------------|
| **Session storage** | `InMemorySessionStore` (resets on deploy) | D1 `role_context_participants` |
| **Candidate auth** | Raw session ID in URL (no JWT) | Clerk JWT for recruiters, candidate JWT for assessments |
| **State ownership** | Backend holds `AgentSession` | Frontend sends `clientState`, backend reconstructs from D1 |
| **Phase transitions** | Generic FSM: `consent → in_progress → scoring → complete` | Domain orchestrator: `team → work → bar → codebase → process → why` |
| **Turn generation** | `plugin.generateTurn()` — one question at a time | `domainGenerator` — batch of 4-6 questions per domain |
| **Eval gate** | Per-turn `runEvalGate()` before delivery | **Disabled** in production |
| **Synthesis trigger** | FSM hits `scoring` state | `domainOrchestrator` signals all domains complete |
| **Scoring** | `scoreSession()` with dimension config | `runRcdSynthesis()` — multi-stakeholder RCD |
| **LLM calls per domain** | 1 per question (no batching) | 1 per domain batch (4-6 questions) |
| **Report** | `GET /api/v1/agents/:type/sessions/:id/report` | Embedded in synthesis response |

### Why It Failed

1. **Session ID as token** — No auth. Anyone guessing the ID can access the interview.
2. **In-memory store** — Sessions vanish on every deploy/restart.
3. **Generic FSM** — `consent → in_progress → scoring → complete` doesn't model role discovery. Role discovery has no "scoring" phase — it produces an RCD, not a candidate score.
4. **Plugin stubs** — All three plugins (`roleDiscovery`, `codeReview`, `culture`) were stubs returning mock data.
5. **No batching** — One LLM call per question vs. one LLM call per domain (4-6 questions).
6. **No multi-stakeholder support** — `AgentSession` has one `candidateId`. Role discovery interviews multiple stakeholders.

---

## 7. The Three Architectures Compared

### 5a. UAR — Proposed, Never Adopted (April 24)

```mermaid
flowchart LR
    subgraph UAR["UAR (agents.ts)"]
        R1["/rpc/agents/:token/consent"]
        R2["/rpc/agents/:token/respond"]
        FSM["createFSM(config)"]
        Store["InMemorySessionStore"]
        Eval["runEvalGate()"]
        Score["scoreSession()"]
    end

    subgraph Plugins["Agent Plugins"]
        P1["roleDiscoveryPlugin<br/>STUB"]
        P2["codeReviewPlugin<br/>STUB"]
        P3["culturePlugin<br/>WRONG DIMS"]
    end

    Frontend --> R2
    R2 --> FSM
    R2 --> Store
    R2 --> Plugins
    Plugins --> Eval
    R2 --> Score
```

**Status:** ❌ Dead code. No auth. In-memory store resets on deploy. All plugins are stubs.

---

### 5b. Split-Endpoint State Machine — Built, Abandoned (April 28)

```mermaid
sequenceDiagram
    participant F as Frontend
    participant S as POST /state
    participant Q as POST /question
    participant Sy as POST /synthesize
    participant R as interviewReducer
    participant G as domainGenerator
    participant Synth as synthesis/generator
    participant LLM as LLM

    Note over F,LLM: Frontend orchestrates — holds InterviewState

    F->>S: {state, action: ANSWER}
    S->>R: interviewReducer()
    R-->>S: newState
    S-->>F: {state}

    F->>F: Check state.synthesisReady

    alt synthesisReady = true
        F->>Sy: {state}
        Sy->>Synth: synthesize()
        Synth->>LLM: complete()
        LLM-->>Synth: persona + JD
        Synth-->>Sy: result
        Sy-->>F: {synthesis}
    else
        F->>Q: {state}
        Q->>G: generateQuestion()
        G->>LLM: complete()
        LLM-->>G: question
        G-->>Q: result
        Q-->>F: {question}
    end
```

**Status:** ❌ Endpoints return 410 Gone. Frontend never cut over.

---

### 5c. Current Production — Monolithic /respond (Today)

```mermaid
sequenceDiagram
    participant F as Frontend
    participant R as POST /respond
    participant Recon as reconstructState
    participant Red as interviewReducer
    participant Orc as domainOrchestrator
    participant Gen as domainGenerator
    participant Synth as runRcdSynthesis
    participant LLM as LLM
    participant D1 as D1

    Note over F,D1: Backend orchestrates everything. Frontend is dumb.

    F->>R: {answer, questionId}
    R->>Recon: reconstruct from DB
    Recon->>D1: SELECT
    D1-->>Recon: raw data
    Recon-->>R: InterviewState

    R->>Red: interviewReducer()
    Red-->>R: partialState

    R->>Orc: getNextDomainDrivenQuestion()

    alt Need questions
        Orc->>Gen: generateDomainQuestions()
        Gen->>LLM: complete()
        LLM-->>Gen: batch
        Gen-->>Orc: questions
    end

    alt All domains complete
        Orc->>Synth: trigger synthesis
        Synth->>D1: Read all participants
        Synth->>LLM: synthesizeRcd()
        LLM-->>Synth: RCD
        Synth->>D1: Persist + decompose
        Synth-->>R: result
        R-->>F: synthesis payload
    else Next question
        Orc-->>R: nextQuestion
        R->>D1: persistQuestionTurn
        R-->>F: question payload
    end
```

**Status:** ✅ This is what actually runs. The frontend calls one endpoint. The backend decides everything.

---

## 8. Data Flow — What Happens to InterviewState

```mermaid
flowchart TB
    subgraph DB["D1 Storage"]
        Exchanges[("exchanges JSON[]")]
        KS[("knowledge_state JSON{}")]
    end

    subgraph Reconstruct["Reconstruct Phase"]
        R1["Parse exchanges"]
        R2["Parse knowledge_state"]
        R3["readDomainCoverage()"]
        R4["selectPhase()"]
        R5["Assemble InterviewState"]
    end

    subgraph Reducer["Reducer Phase"]
        E["ANSWER action"]
        E1["Append answer to last exchange"]
        E2["Increment questionsAsked"]
        E3["Apply domainCoverage override"]
    end

    subgraph PostReducer["Post-Reducer (Broken)"]
        P1["Check state.synthesisReady"]
        P2["⚠️ STALE — was set during reconstruction, not updated"]
    end

    subgraph Orchestrator["Orchestrator Phase (The Real Logic)"]
        O1["getNextDomainDrivenQuestion()"]
        O2["Check domainCompletion"]
        O3["If complete → advance domain"]
        O4["If all complete → trigger synthesis"]
    end

    Exchanges --> R1
    KS --> R2
    R1 --> R5
    R2 --> R3
    R3 --> R4
    R4 --> R5
    R5 --> E
    E --> E1
    E --> E2
    E --> E3
    E1 --> P1
    E2 --> P1
    E3 --> P1
    P1 --> P2
    P2 --> O1
    O1 --> O2
    O2 --> O3
    O2 --> O4
```

---

## 9. Provider Chain & Fallback

```mermaid
flowchart LR
    subgraph Config["Environment Config"]
        A["ROLE_AGENT_PROVIDER<br/>default: cloudflare-ai"]
        B["ROLE_AGENT_SYNTHESIS_PROVIDER<br/>default: cloudflare-ai"]
    end

    subgraph Primary["Primary Provider"]
        P1["Cloudflare Workers AI<br/>@cf/google/gemma-3-27b-it"]
        P2["Vertex AI<br/>google/gemma-4-26b-a4b-it-maas"]
        P3["Kimi<br/>kimi-k2-6"]
    end

    subgraph Fallback["Fallback Chain"]
        F1["Try Cloudflare"]
        F2["Try Vertex"]
        F3["Try Kimi"]
    end

    A -->|"cloudflare-ai"| P1
    A -->|"vertex-ai"| P2
    A -->|"kimi"| P3

    P1 -->|"fails"| F2
    P2 -->|"fails"| F1
    P3 -->|"fails"| F2

    F2 -->|"fails"| F3
    F1 -->|"fails"| F3

    F3 -->|"all fail"| Error["Error: No provider available"]
```

---

## 10. Synthesis Flow (When Interview Completes)

```mermaid
flowchart TB
    Start(["All domains complete"]) --> ReadParticipants["Read ALL participants<br/>for this role context"]
    ReadParticipants --> D1[("D1")]
    D1 --> ExtractTranscripts["Extract transcripts<br/>from each participant"]

    ExtractTranscripts --> BuildPrompt["buildRcdSynthesisUserMessage()<br/>+ buildRcdSynthesisSystemPrompt()"]
    BuildPrompt --> LLM["LLM Provider<br/>(synthesis provider chain)"]
    LLM --> ParseJSON["Parse RCD JSON"]

    ParseJSON --> PersistRCD["Persist to role_contexts.rcd_json"]
    ParseJSON --> Decompose["decomposeRcdIntoNodes()<br/>→ Neo4j role nodes"]
    ParseJSON --> Embed["buildAndStoreRoleEmbedding()<br/>→ Vectorize"]

    PersistRCD --> D1
    Decompose --> Neo4j[("Neo4j")]
    Embed --> Vectorize[("Vectorize")]

    PersistRCD --> Return["Return to frontend:<br/>{persona, jobDescription, rcd}"]
    Return --> End(["User sees results"])
```

---

## 11. The Broken Part — Visualized

```mermaid
flowchart TB
    subgraph WhatTheReducerDoes["interviewReducer() — What It Actually Does"]
        R1["✅ Append answer"]
        R2["✅ Increment questionsAsked"]
        R3["✅ Patch domainCoverage"]
        R4["✅ Track domain counts"]
    end

    subgraph WhatTheReducerShouldDo["What a Real Reducer Should Do"]
        S1["✅ Append answer"]
        S2["✅ Increment questionsAsked"]
        S3["✅ Patch domainCoverage"]
        S4["✅ Track domain counts"]
        S5["✅ Recompute phase"]
        S6["✅ Recompute synthesisReady"]
        S7["✅ Update reasoning"]
        S8["✅ Update urgentGaps"]
    end

    subgraph WhatActuallyHappens["What Actually Happens in Production"]
        A1["Reducer runs — returns partial state"]
        A2["⚠️ state.phase is stale"]
        A3["⚠️ state.synthesisReady is stale"]
        A4["Domain orchestrator ignores phase"]
        A5["Domain orchestrator decides completion"]
        A6["Synthesis triggers when orchestrator says so"]
    end

    WhatTheReducerDoes -->|"Missing"| WhatTheReducerShouldDo
    WhatTheReducerDoes --> WhatActuallyHappens
```

---

## 12. Clean Architecture (What It Should Look Like)

```mermaid
flowchart TB
    subgraph Frontend2["Frontend (Minimal Change)"]
        F1["User submits answer"]
        F2["POST /respond {answer}"]
        F3["Show question or synthesis"]
    end

    subgraph Backend2["Backend — Simplified /respond"]
        B1["Reconstruct state from DB"]
        B2["interviewReducer(state, ANSWER)"]
        B3["selectPhase(newState) → update phase, synthesisReady"]
        B4["domainOrchestrator.decideNext(state)"]
        B5["Generate questions OR trigger synthesis"]
        B6["Persist"]
    end

    F1 --> F2
    F2 --> B1
    B1 --> B2
    B2 --> B3
    B3 --> B4
    B4 -->|"Need question"| B5
    B4 -->|"Interview complete"| B5
    B5 --> B6
    B6 --> F3
```

**Changes needed:**
1. Call `selectPhase()` inside or immediately after `interviewReducer()`
2. Remove the stale `state.synthesisReady` check in `/respond`
3. Trust `domainOrchestrator` to signal completion
4. Delete dead code (UAR, 410 endpoints, unused generator/eval/reflector)
