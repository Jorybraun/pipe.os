# E2E Test Status

Last run: 2026-03-26

Legend: ✅ Pass · ❌ Fail · ⏭ Skipped (blocked by earlier failure in serial suite)

---

## auth.setup.ts

| Status | Test | Description |
|--------|------|-------------|
| ✅ | authenticate | Logs in with E2E credentials via Cognito and saves auth state for all recruiter tests |

---

## happy-path.spec.ts

### Candidate Assessment Route (unauthenticated)

| Status | Test | Description |
|--------|------|-------------|
| ✅ | renders invalid-token screen for unknown token (not 404) | Visiting `/assess/bad-token` shows an "Invalid Invite Link" error, not a blank 404 page |
| ✅ | renders loading state immediately on navigation | Visiting any `/assess/:token` URL renders something immediately — page is never blank |

### Recruiter Pipeline Flow (serial)

| Status | Test | Description |
|--------|------|-------------|
| ❌ | creates a new pipeline in DRAFT status | Fills the pipeline creation form, submits, and verifies the pipeline lands in DRAFT state with a PUBLISH button visible. **Fails because the app creates pipelines as ACTIVE, not DRAFT** |
| ⏭ | can add a stage to a DRAFT pipeline | Clicks ADD_STAGE on a DRAFT pipeline and confirms the new stage appears |
| ⏭ | can delete an individual stage via the trash button | Clicks the trash icon on a stage and confirms the stage count decreases |
| ⏭ | ChallengePicker shows all 4 challenge type tabs including QUIZ types | Opens ChallengePicker and confirms CODE_REVIEW, QUIZ_MCQ, QUIZ_SHORT_ANSWER, and CODE_IMPLEMENTATION tabs are all present |
| ⏭ | CODE_REVIEW tab shows saved repos dropdown and Add Repo button | On the CODE_REVIEW tab, confirms ADD_REPO button is visible and clicking it reveals the URL input |
| ⏭ | recruiter can publish a DRAFT pipeline to ACTIVE | Clicks PUBLISH_PIPELINE and confirms the button disappears, indicating the pipeline is now ACTIVE |

### CandidateProfilePage

| Status | Test | Description |
|--------|------|-------------|
| ❌ | profile page loads without crashing for a candidate who has not submitted | Navigates to an existing candidate profile from the home page and confirms no error state is shown. **Fails because the home page has no candidate links to click** |

---

## candidate-flow.spec.ts

| Status | Test | Description |
|--------|------|-------------|
| ❌ | Candidate assessment page renders correctly without authentication | Visits `/assess/:token` and confirms an `h1` heading is visible. **Fails — no `h1` found on the assessment page** |
| ❌ | Progress indicator and navigation work | Confirms the `COMPLETE_CHALLENGE_TO_CONTINUE` footer text and a disabled NEXT button are shown before answering. **Fails — selector does not match actual UI text** |
| ✅ | Can complete a simple quiz challenge | Selects a quiz option, confirms the NEXT button becomes enabled, and advances the challenge |

---

## code-review-challenge.spec.ts

| Status | Test | Description |
|--------|------|-------------|
| ❌ | Scenario: full CODE_REVIEW happy path | Full candidate journey — welcome screen → diff view → select verdict → write summary → submit → answer 5 follow-up questions → reach "Submitted." screen. **Fails — fixture token is expired (INVALID_TOKEN)** |
| ❌ | Scenario: candidate can skip follow-up questions | After submitting the code review, confirms the SKIP_FOLLOW_UP button exists and leads to "Submitted." without answering questions. **Fails — fixture token is expired (INVALID_TOKEN)** |

---

## code-review-happy-path.spec.ts

| Status | Test | Description |
|--------|------|-------------|
| ❌ | Full CODE_REVIEW flow: welcome → diff → submit → follow-ups → submitted | Same end-to-end journey as above with more granular step-by-step assertions on the diff viewer and question counter. **Fails — fixture token is expired (INVALID_TOKEN)** |

---

## recruiter-code-review.spec.ts

| Status | Test | Description |
|--------|------|-------------|
| ❌ | Scenario: recruiter views pipeline with CODE_REVIEW challenge | Navigates to the fixture pipeline and confirms the CODE_REVIEW challenge card is visible. **Fails — fixture pipelineId points to deleted data** |
| ❌ | Scenario: recruiter adds a candidate and copies invite link | Clicks ADD_CANDIDATE, fills the email form, sends the invite, and confirms the candidate card + copy-link button appear. **Fails — fixture pipelineId points to deleted data** |
| ❌ | Scenario: recruiter can view challenge editor for the CODE_REVIEW challenge | Navigates directly to `/pipeline/:id/challenges/:id` and confirms the challenge editor loads. **Fails — fixture pipelineId/challengeId point to deleted data** |

---

## candidate-scores.spec.ts

| Status | Test | Description |
|--------|------|-------------|
| ❌ | Scenario: Candidate with no submissions shows — not 0 | Visits a candidate who has no submissions and confirms the overall score shows "—" instead of "0". **Fails — fixture candidateId points to deleted data, profile never loads** |
| ❌ | Scenario: Candidate profile page loads for CODE_REVIEW candidate | Visits a seeded CODE_REVIEW candidate profile and confirms the CANDIDATE_PROFILE header and OVERVIEW tab are visible. **Fails — fixture candidateId points to deleted data** |
| ❌ | Scenario: Stage tab shows score chip when stage has submissions | Confirms a stage with completed challenges shows a numeric score or SIGNAL section. **Fails — fixture candidateId points to deleted data** |
| ❌ | Scenario: Intelligence tab visible when flag enabled | Confirms the INTELLIGENCE tab with a BETA badge appears in the tab bar when the feature flag is on. **Fails — fixture candidateId points to deleted data** |
| ❌ | Scenario: Intelligence tab renders executive summary and stage performance | Clicks the INTELLIGENCE tab and confirms EXECUTIVE_SUMMARY and STAGE_PERFORMANCE section headers render. **Fails — fixture candidateId points to deleted data** |
| ❌ | Scenario: Challenge deep dives section is visible in intelligence tab | Clicks the INTELLIGENCE tab and confirms the CHALLENGE_DEEP_DIVES section header renders. **Fails — fixture candidateId points to deleted data** |
| ❌ | Scenario: Stage tabs render challenge cards not intelligence report | Clicks a stage tab and confirms challenge cards render and EXECUTIVE_SUMMARY is not visible. **Fails — fixture candidateId points to deleted data** |

---

## cv-upload-and-profile.spec.ts

| Status | Test | Description |
|--------|------|-------------|
| ❌ | Given: at least one pipeline exists in the recruiter account | Navigates to the home page and finds a pipeline card to click into. **Fails — home page finds no pipeline cards** |
| ⏭ | When: recruiter opens the candidate intake modal | Clicks ADD_CANDIDATE on the pipeline and confirms the intake modal appears |
| ⏭ | And: recruiter uploads PDF, sees PARSING state and CONFIRM step | Fills the form, attaches a PDF, submits, and waits for the AI parsing Lambda to return a parsed profile |
| ⏭ | Then: candidate profile shows AI_PARSED_PROFILE and VIEW_RESUME opens S3 URL | Confirms the candidate profile shows parsed data and the VIEW_RESUME button opens an AWS S3 URL |

---

## short-answer-media-config.spec.ts

### Recruiter configures QUIZ_SHORT_ANSWER inputMode

| Status | Test | Description |
|--------|------|-------------|
| ❌ | inputMode selector: defaults to TEXT, toggles VOICE/VIDEO, shows/hides QUESTION_VIDEO | Opens the short-answer challenge editor and confirms TEXT is the default, toggling to VOICE/VIDEO shows the video question section, and switching back to TEXT hides it. **Fails — selector mismatch or fixture data invalid** |

### Candidate sees textarea for TEXT mode challenge

| Status | Test | Description |
|--------|------|-------------|
| ✅ | TEXT mode challenge shows QUESTION_PROMPT textarea, no voice/video controls | Visits a TEXT mode short-answer assessment and confirms no voice or video recording buttons are present |

### Candidate sees VoicePanel for VOICE mode challenge

| Status | Test | Description |
|--------|------|-------------|
| ❌ | VOICE mode renders START_VOICE_RECORDING button | Visits a VOICE mode assessment and confirms the start recording button is visible. **Fails — button not found** |
| ✅ | VOICE mode does not show video recording controls | Confirms no START_RECORDING (video) button appears in VOICE mode |
| ❌ | VOICE mode shows editable transcript textarea | Confirms a textarea for typing or editing the voice transcript is visible. **Fails — textarea not found** |
| ❌ | VOICE mode: typing in textarea enables NEXT/SUBMIT | Types into the transcript textarea and confirms the NEXT button becomes enabled. **Fails — textarea not found** |

### Candidate sees VideoSubmissionPanel for VIDEO mode challenge

| Status | Test | Description |
|--------|------|-------------|
| ❌ | VIDEO mode renders START_RECORDING button and MAX_DURATION hint | Visits a VIDEO mode assessment and confirms the record button and duration hint are visible. **Fails — button not found** |
| ✅ | VIDEO mode does not show voice recording controls | Confirms no START_VOICE_RECORDING button appears in VIDEO mode |
| ❌ | VIDEO mode: NEXT/SUBMIT is disabled before upload completes | Confirms the NEXT button is disabled until a video has been recorded and uploaded. **Fails — button state incorrect or element missing** |
| ❌ | VIDEO mode: recording flow shows REC indicator then SUBMIT_VIDEO | Clicks START_RECORDING, confirms a REC indicator appears, stops recording, and confirms SUBMIT_VIDEO button appears. **Fails — UI elements not found in expected sequence** |

### Recruiter sees candidate media submissions in profile

| Status | Test | Description |
|--------|------|-------------|
| ❌ | Voice submission shows VOICE_TRANSCRIPT label in profile | Navigates to the profile of a candidate who completed a VOICE challenge and confirms the VOICE_TRANSCRIPT label is visible in their stage tab. **Fails — fixture candidateId points to deleted data** |
| ❌ | Video submission shows CANDIDATE_VIDEO_RESPONSE label in profile | Navigates to the profile of a candidate who completed a VIDEO challenge and confirms the CANDIDATE_VIDEO_RESPONSE label is visible. **Fails — fixture candidateId points to deleted data** |
| ✅ | Legacy text submission (no inputMode field) renders plain text | Confirms a candidate with a legacy code-review submission shows plain text (no voice/video labels) in their profile |

---

## Summary

| | Count |
|---|---|
| ✅ Passing | 11 |
| ❌ Failing | 36 |
| ⏭ Skipped | 10 |
| **Total** | **57** |

### Root causes

1. **Expired fixture tokens / deleted records** — `playwright/code-review-token.json`, `playwright/candidate-token.json`, `playwright/voice-candidate-profile.json`, `playwright/video-candidate-profile.json` all reference data that no longer exists. Affects 22 tests.
2. **App creates pipelines as ACTIVE, not DRAFT** — `PipelineCreatePage.tsx:83` sets `status: 'ACTIVE'`. The serial recruiter suite (6 tests) is blocked on this.
3. **Selector mismatches** — `COMPLETE_CHALLENGE_TO_CONTINUE`, `h1`, `START_VOICE_RECORDING`, transcript textarea, and video recording flow selectors don't match what the current UI renders. Affects ~8 tests.
4. **Empty account state** — CV upload test and profile test assume pipeline/candidate data exists on the home page.
