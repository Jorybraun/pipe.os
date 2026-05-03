# Frontend Changes

**Owner:** Frontend Team  
**Status:** PENDING  
**Source strategy:** `culture-agent-redesign-master.md` §5.1  
**Blocked by:** `integration/stage-progression-gate.md`  
**Blocks:** None  

---

## 1. Problem Statement

The frontend needs to handle a new challenge type (`WAITING_FOR_MATCH`) and display the Mode-1 screener as a profile-building step rather than an assessment. The current UI assumes every stage has a challenge with a repo/PR. The new flow introduces a synthetic waiting state.

## 2. Current State

**Current stage progression (`useRoleDiscovery.ts` or equivalent):**
```typescript
// Frontend polls get-stage-config
// Expects challenge with github_repo_url, github_pr_number, issue_number
// Displays code review diff or implementation issue
```

**Current culture interview UI:**
- Displays question text
- Textarea for answer
- "Submit" button
- Progress bar ("Question X of 15")

## 3. Target State

### 3.1 WAITING_FOR_MATCH challenge

When `get-stage-config` returns `type: 'WAITING_FOR_MATCH'`:

```tsx
function WaitingForMatchChallenge({ challenge }: { challenge: WaitingChallenge }) {
  return (
    <div className="waiting-container">
      <Spinner size="lg" />
      <h2>{challenge.title}</h2>
      <p>{challenge.instructions}</p>
      <ProgressBar
        indeterminate
        label="Analyzing your profile..."
      />
      <p className="refresh-hint">
        This page will refresh automatically.
      </p>
    </div>
  );
}
```

**Auto-refresh:**
```typescript
useEffect(() => {
  if (challenge.config.autoRefresh) {
    const interval = setInterval(() => {
      refetchStageConfig();
    }, challenge.config.refreshIntervalSeconds * 1000);
    return () => clearInterval(interval);
  }
}, [challenge]);
```

### 3.2 Mode-1 screener UI

The Mode-1 screener uses the same interview UI as Mode-2, but with different framing:

```tsx
function ScreenerHeader({ mode }: { mode: 'profile_builder' | 'role_fit' }) {
  if (mode === 'profile_builder') {
    return (
      <div className="screener-header">
        <h1>Build your profile</h1>
        <p>
          Help us understand your experience and working style so we can
          find the best challenge for you. This takes 10–15 minutes.
        </p>
        <p className="privacy-note">
          Your answers build your candidate profile. You can review and edit
          it after we're done.
        </p>
      </div>
    );
  }
  // Mode-2 header (existing)
}
```

**Progress bar:** Show dimension coverage instead of question count.

```tsx
function CoverageProgress({ coverage }: { coverage: CoverageState }) {
  return (
    <div className="coverage-bars">
      <CoverageBar label="Experience" value={coverage.experience.completeness} />
      <CoverageBar label="Cultural" value={coverage.cultural.completeness} />
      <CoverageBar label="Technical" value={coverage.technical.completeness} />
      <CoverageBar label="Motivation" value={coverage.motivation.completeness} />
      <CoverageBar label="Context" value={coverage.context.completeness} />
    </div>
  );
}
```

### 3.3 Profile review page (post-Mode-1)

After Mode-1, candidates can view their extracted profile:

```tsx
function CandidateProfileReview({ nodes }: { nodes: CandidateNode[] }) {
  return (
    <div className="profile-review">
      <h2>Your profile</h2>
      <p>Review what we learned. You can edit or remove anything.</p>

      <section>
        <h3>Skills</h3>
        <SkillList skills={nodes.filter(n => n.nodeType === 'Skill')} />
      </section>

      <section>
        <h3>Experience</h3>
        <ExperienceList experiences={nodes.filter(n => n.nodeType === 'Experience')} />
      </section>

      <section>
        <h3>Working style</h3>
        <WorkingStyleList styles={nodes.filter(n => n.nodeType === 'WorkingStyle')} />
      </section>

      <button onClick={onConfirm}>Looks good — find my challenge</button>
      <button onClick={onEdit}>Edit profile</button>
    </div>
  );
}
```

**Note:** Profile review is a **Phase 1 feature**. The synthesis output (`candidate_profile_json`) produces a structured timeline that renders immediately. The candidate reviews their profile before matching runs.

## 4. Implementation Details

### 4.1 Type changes

```typescript
// Add to Challenge type union
type Challenge =
  | CodeReviewChallenge
  | ImplementationChallenge
  | QuizChallenge
  | CultureInterviewChallenge
  | WaitingForMatchChallenge; // NEW

interface WaitingForMatchChallenge {
  id: string;
  type: 'WAITING_FOR_MATCH';
  title: string;
  instructions: string;
  config: {
    autoRefresh: boolean;
    refreshIntervalSeconds: number;
    estimatedSecondsRemaining: number;
  };
}
```

### 4.2 File changes

| File | Change |
|---|---|
| `src/pages/ChallengePage.tsx` | **Modify.** Handle `WAITING_FOR_MATCH` challenge type. |
| `src/components/WaitingForMatch.tsx` | **New.** Spinner + progress + auto-refresh. |
| `src/components/ScreenerHeader.tsx` | **New.** Mode-aware header. |
| `src/components/CoverageProgress.tsx` | **New.** Dimension coverage bars. |
| `src/types/challenge.ts` | **Modify.** Add `WaitingForMatchChallenge` to union. |

## 5. Open Questions

1. **Should the candidate see coverage progress during the interview?** It could motivate them to give richer answers. Or it could make them game the system. — **Recommendation:** Yes, show coverage. Frame it as "helping us understand you" not "passing a test."

2. **What if the candidate closes the tab during WAITING_FOR_MATCH?** They'll reopen and poll again. — **Recommendation:** Store last-seen challenge in localStorage. On reopen, check if status changed.

## 6. Validation Criteria

- **Unit test:** `WaitingForMatch` component polls at correct interval.
- **E2E test:** Candidate sees spinner, then auto-navigates to CODE_REVIEW when ready.
- **E2E test:** Screener header shows "Build your profile" for Mode-1.

## 7. Risks and Mitigations

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| Candidate is confused by WAITING_FOR_MATCH | Medium | Medium | Clear copy: "Building your personalized challenge. This takes 2–3 minutes." |
| Auto-refresh causes infinite loop if backend is broken | Low | High | Max 20 polls, then show "Something went wrong" with recruiter contact. |
| Coverage progress makes candidates anxious | Medium | Low | Use calming colors, no red/green pass/fail semantics. |
