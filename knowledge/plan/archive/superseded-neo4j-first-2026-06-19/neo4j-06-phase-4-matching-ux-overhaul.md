# Phase 4: Matching UX Overhaul — Per-Requirement Evidence

This phase replaces the opaque triangulated score UX with requirement-level evidence cards. The backend Cypher query already returns the data; we just need to render it.

---

## 1. Current UX (What We Are Replacing)

### `MatchSnapshot` in `CandidateOverviewTab.tsx`

```tsx
if (!ingestion || ingestion.status !== 'matched') return null;
const score = ingestion.triangulatedScore;        // e.g. 0.87
const dims = ingestion.dimensions;                // { skillCoverage, semanticSimilarity, situationFit, roleAlignment }

// Renders:
// "87 / 100 MATCH"
// 4 bars: skillCoverage (0.82), semanticSimilarity (0.91), situationFit (0.75), roleAlignment (0.88)
// STRENGTHS: ingestion.reasoning.matches (string[])
// GAPS: ingestion.reasoning.mismatches (string[])
```

**Problem:** The recruiter sees "87/100" with 4 colored bars but has NO idea:
- Which requirements did the candidate match?
- Which candidate evidence produced the score?
- Why is "situation fit" only 0.75?
- Is the candidate strong on React but weak on leadership?

### `MatchScoreSection` in Profile Page

Same pattern — big score ring + 4 dimension bars + match/mismatch tags.

---

## 2. New UX Design

### Core Principle: **The match report is the primary output; the score is a derived summary.**

Recruiters should see, per candidate per role:
1. **Overall score** — for sorting and coarse filtering (keep this)
2. **Per-requirement breakdown** — which requirements matched, which didn't
3. **Evidence nodes** — specific candidate sub-elements that produced the match
4. **Source attribution** — where the evidence came from (resume, code review, culture interview)
5. **Dealbreaker flags** — red alerts for failed must-haves

---

## 3. New API Response Shape

The `matchViaNeo4j` path in `matchRouter.ts` returns:

```typescript
interface UnifiedMatchResult {
  candidateId: string;
  score: number;                          // 0-1, tanh-normalized overall
  name?: string;
  email?: string;
  requirementMatches: RequirementMatch[];
  dealbreakerFailures: DealbreakerFailure[];
}

interface RequirementMatch {
  requirementId: string;
  requirementText: string;                // "Must have 2+ years production Kafka experience"
  score: number;                          // 0-1, per-requirement
  weight: number;                         // 0.4 (importance in role)
  matchCount: number;                     // how many candidate nodes matched
  evidence: EvidenceNode[];
}

interface EvidenceNode {
  nodeId: string;
  nodeType: 'Experience' | 'TechnicalDemonstration' | 'Skill' | 'CulturalSignal';
  narrative: string;                      // "Built event-streaming pipeline with Kafka at Stripe"
  similarity: number;                     // 0.89 (cosine similarity)
  barsScore?: number;                     // 4.5 (BARS score, if from assessment)
  sourceType: string;                     // "resume" | "code_review_session" | "culture_interview"
  capturedAt: string;                     // ISO date
}

interface DealbreakerFailure {
  dealbreakerId: string;
  narrative: string;                      // "Must be legally authorized to work in the EU"
  matchedSimilarity: number;              // 0.32 (best match, below 0.75 threshold)
}
```

---

## 4. New Frontend Components

### 4.1 `RequirementMatchCard`

**Location:** `src/components/Match/RequirementMatchCard.tsx`

**Props:**
```typescript
interface Props {
  requirementText: string;
  score: number;
  weight: number;
  matchCount: number;
  evidence: EvidenceNode[];
  isExpanded?: boolean;
}
```

**Design:**
```
┌─────────────────────────────────────────────────────────────┐
│ ▼ Kafka & Event Streaming — 89% match (weight: 0.4)        │
│                                                             │
│  Evidence (3 nodes):                                       │
│  ┌─ 💼 Experience — 0.89 sim                               │
│  │  "Built event-streaming pipeline with Kafka at Stripe"  │
│  │  from resume · captured 2024-03-15                      │
│  ├─ 🔧 Technical Demo — 0.82 sim · BARS: 4.5              │
│  │  "Demonstrated async/await pattern understanding"        │
│  │  from code review · captured 2024-04-02                 │
│  └─ 🎯 Skill — 0.71 sim                                    │
│     "Apache Kafka, RabbitMQ, Redis Streams"                │
│     from resume · captured 2024-03-15                      │
└─────────────────────────────────────────────────────────────┘
```

**Color coding:**
- Score ≥ 0.7: Green bar
- Score 0.4-0.7: Yellow bar
- Score < 0.4: Red bar

### 4.2 `EvidenceNodeBadge`

**Location:** `src/components/Match/EvidenceNodeBadge.tsx`

**Icons by source_type:**
| Source | Icon | Color |
|--------|------|-------|
| `resume` | 📄 | Blue |
| `code_review_session` | 🔧 | Purple |
| `culture_interview` | 💬 | Orange |
| `screening` | 📝 | Gray |
| `enrichment` | 🔗 | Teal |

**Icons by node_type:**
| Type | Icon |
|------|------|
| `Experience` | 💼 |
| `TechnicalDemonstration` | 🔧 |
| `Skill` | 🎯 |
| `CulturalSignal` | 💬 |

### 4.3 `DealbreakerAlert`

**Location:** `src/components/Match/DealbreakerAlert.tsx`

```
┌─────────────────────────────────────────────────────────────┐
│ ⚠️ DEALBREAKER FLAG                                         │
│                                                             │
│  "Must be legally authorized to work in the EU"            │
│  Best evidence match: 0.32 (below 0.75 threshold)          │
└─────────────────────────────────────────────────────────────┘
```

### 4.4 `RequirementMatchList`

**Location:** `src/components/Match/RequirementMatchList.tsx`

Replaces `MatchSnapshot` in `CandidateOverviewTab.tsx`.

**Props:**
```typescript
interface Props {
  overallScore: number;
  requirementMatches: RequirementMatch[];
  dealbreakerFailures: DealbreakerFailure[];
}
```

**Layout:**
```
┌─────────────────────────────────────────────────────────────┐
│  MATCH SCORE                                                │
│  ┌────────┐                                                 │
│  │  87    │  Overall match score                            │
│  │  /100  │                                                 │
│  └────────┘                                                 │
│                                                             │
│  Matched 5/8 requirements                                   │
│                                                             │
│  ┌─ ▼ Requirement 1 — 89% match ─────────────────────────┐ │
│  │   [evidence cards...]                                  │ │
│  └────────────────────────────────────────────────────────┘ │
│  ┌─ ▶ Requirement 2 — 72% match ─────────────────────────┐ │
│  └────────────────────────────────────────────────────────┘ │
│  ┌─ ▶ Requirement 3 — 45% match ─────────────────────────┐ │
│  └────────────────────────────────────────────────────────┘ │
│  ┌─ ▶ Requirement 4 — 12% match (NO EVIDENCE) ───────────┐ │
│  └────────────────────────────────────────────────────────┘ │
│                                                             │
│  ⚠️ 1 dealbreaker flagged                                   │
└─────────────────────────────────────────────────────────────┘
```

### 4.5 `MatchScoreRing` (Updated)

**Location:** `src/components/Candidate/profile-sections/MatchScoreSection.tsx`

Keep the big score ring for visual impact, but change what it represents:
- **Before:** "Triangulated Score" (opaque)
- **After:** "Overall Match" (derived from per-requirement evidence)

Add a subtitle: "Based on 5 matched requirements with 14 evidence nodes"

---

## 5. Component Replacement Map

| Old Component | New Component | File to Edit |
|---------------|---------------|--------------|
| `MatchSnapshot` | `RequirementMatchList` | `CandidateOverviewTab.tsx` |
| `DimensionBar` (4 bars) | `RequirementMatchCard` list | `MatchScoreSection.tsx` |
| `MatchScoreSection` (score only) | `MatchScoreSection` + `RequirementMatchList` | `profile-sections/MatchScoreSection.tsx` |
| Kanban score badge | Kanban score badge + hover tooltip | `KanbanCard.tsx` or equivalent |

---

## 6. Kanban / List View Updates

Keep the score badge (recruiters need at-a-glance sorting), but on hover show:

```
┌─────────────────────────────────────────┐
│  Alice Chen — 87/100                     │
│  ━━━━━━━━━━━━━━━━━━━━━━━                 │
│  Matched 5/8 requirements                │
│  Top match: Kafka (0.89)                 │
│  Weakest: Leadership (0.12)              │
│  ⚠️ Flag: Missing EU work authorization  │
└─────────────────────────────────────────┘
```

**Implementation:** Add a `title` attribute or a custom tooltip component to the score badge.

---

## 7. API Integration

### Update `useMatchQuery` hook

```typescript
// src/hooks/useMatchQuery.ts
export function useMatchQuery(roleContextId: string) {
  return useQuery({
    queryKey: ['match', roleContextId],
    queryFn: async () => {
      const res = await api.post('/search/candidates', { roleContextId });
      return res.data as UnifiedMatchResult[];
    },
  });
}
```

### Update `CandidateOverviewTab.tsx`

```tsx
// BEFORE
<MatchSnapshot ingestion={candidate.ingestion} />

// AFTER
{matchData && (
  <RequirementMatchList
    overallScore={matchData.score}
    requirementMatches={matchData.requirementMatches}
    dealbreakerFailures={matchData.dealbreakerFailures}
  />
)}
```

---

## 8. Fallback for Old Data

During the transition, some candidates may not have Neo4j match data yet. Show a graceful fallback:

```tsx
{matchData ? (
  <RequirementMatchList {...matchData} />
) : candidate.ingestion?.status === 'matched' ? (
  <LegacyMatchSnapshot ingestion={candidate.ingestion} />
) : (
  <NoMatchData />
)}
```

---

## 9. Verification

```bash
# 1. Open candidate profile page
# 2. Verify RequirementMatchList renders
# 3. Click to expand a requirement card
# 4. Verify evidence nodes show with correct icons
# 5. Verify dealbreaker alert renders if present
# 6. Verify kanban hover tooltip works
# 7. Run Storybook stories
npm run storybook
# Check Match components

# 8. E2E tests
npm run e2e -- candidate-profile.spec.ts
```

---

## 10. Estimated Effort

| Task | Time |
|------|------|
| Create `RequirementMatchCard` component | 2 hours |
| Create `EvidenceNodeBadge` component | 1 hour |
| Create `DealbreakerAlert` component | 1 hour |
| Create `RequirementMatchList` component | 2 hours |
| Update `MatchScoreSection` | 1 hour |
| Update `CandidateOverviewTab` | 30 min |
| Update kanban/tooltip | 1 hour |
| Update Storybook stories | 1 hour |
| E2E test updates | 2 hours |

**Total: ~12 hours**
