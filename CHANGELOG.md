# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Fixed — CODE_REVIEW scoring

- Judge-example verification now audits the real remote dev D1 database (`pipe-db-test`) through Wrangler instead of only local Miniflare SQLite files, so the production CODE_REVIEW scoring loop validates the same labelled examples created by the app-dev smoke.

### Fixed — Interview scheduling

- Recruiter interview list/detail assessment setup now explains when role-backed CODE_REVIEW matching found a source-backed PR but withheld automatic assignment because the match quality gate failed, so AI ingestion no longer looks silently stuck at the generic profile-received handoff.
- Open-source assessment setup now retries transient GitHub base-commit verification failures before rejecting a manual challenge packet, reducing false `SERVICE_UNAVAILABLE` failures during real assessment creation.
- Scheduled interview invite delivery now returns the room or assessment link immediately and queues provider email sending in the Worker background, removing slow email-provider latency from the create modal's critical path.
- New interview creation now keeps a visible pending state, blocks accidental modal dismissal while submitting, surfaces create failures without clearing form input, stops waiting on the list refresh before showing success, and returns a recoverable message when invite delivery is slow.
- Scheduling live-update hooks now cap retained SSE notification history and clear toast timers on unmount, preventing the interviews route from growing browser memory indefinitely during noisy dev sessions.

### Fixed — Talent Pool ingestion

- Talent Pool dev smoke now infers the remote D1 database id from the target app/API environment, so `app-dev` audits the `dev` D1 database instead of accidentally falling back to the root `CLOUDFLARE_D1_DATABASE_ID`.
- Talent Pool dev smoke now defaults candidate RPC calls to the app-dev proxy and omits dev Basic Auth on direct `api-dev` RPC calls, so smoke proofs exercise the same proxy path candidates use while still supporting explicit API overrides.
- Talent Pool unextractable PDF/DOCX uploads now remain explicit missing-evidence gaps instead of queuing a doomed background resume parser that marks candidate ingestion failed.
- Talent Pool upload routing now skips background document parsing when foreground extraction already proved an uploaded PDF/DOCX has no usable source text, preserving the pending `profile_text_extraction_needed` evidence-gap state.
- Candidate-ingestion audit output now includes current-step counts, making missing-evidence states such as `profile_text_extraction_needed` visible in smoke proofs.
- Added `smoke:talent-pool-ingestion-dev` to create a dev Talent Pool candidate, submit public profile evidence, and poll the candidate-ingestion audit for source-backed person projection proof.
- Added `smoke:talent-pool-upload-dev` to prove multipart plain-text Talent Pool uploads reach the same source-backed person projection, including the original upload artifact receipt.
- Added `smoke:talent-pool-docx-dev` to prove live DOCX profile uploads extract exact source spans, preserve the upload artifact receipt, and stay free of source-less or duplicate projections.
- Added `smoke:talent-pool-pdf-gap-dev` to prove unextractable PDF Talent Pool uploads preserve the raw upload receipt and person projection while remaining an explicit missing-evidence gap with no source-less positive claims or duplicate projected edges.
- Unextractable Talent Pool PDF/DOCX background ingestion now remains a pending `profile_text_extraction_needed` evidence gap and no longer projects the uploaded filename placeholder as candidate profile evidence.
- Talent Pool dev smokes now verify recruiter read surfaces after audit readiness: candidate living context, unified People list, candidate/person source search, person timeline, and evidence-depth must all resolve the same canonical workspace person.
- Public Talent Pool intake Playwright proof now skips Clerk testing setup when recruiter auth env vars are absent, so unauthenticated `/talent/:token` browser tests can run locally.
- Talent Pool dashboard readiness now requires the assigned repo/PR to materialize through a production-ready source-backed review challenge packet, and the candidate-ingestion audit reports PR-backed assignment rows without packet provenance as unproven readiness gaps.
- Recruiter pipeline candidate lists and candidate enrichment status now surface failed AI ingestion with the stored error text and a `RETRY_FAILED` action that calls the source-backed repair endpoint, so stalled candidates can be requeued from the app instead of requiring a terminal API call.
- Recruiter pipeline ingestion now exposes an owned `POST /api/v1/pipelines/:pipelineId/ingestion/retry-failed` repair action that replays failed, missing, or stalled candidate ingestion from the original R2 source evidence instead of waiting on unreliable dev cron behavior.
- Talent Pool profile submit/upload now creates the design queue before scheduling background ingestion, preserving explicit challenge-design state while candidate AI/evidence ingestion runs.
- Talent Pool text-profile ingestion now starts from source-backed rule-based parsing instead of waiting on the resume-decomposition LLM before candidate discovery, preventing submitted profiles from stalling at `talent_pool_profile_received`.
- Talent Pool live text/profile ingestion now uses the bounded source-backed decomposition path before candidate discovery, so app-dev submissions do not burn the Worker background window embedding every candidate node before AI discovery can finish or fall back.
- Roleless Talent Pool person projection now has direct replay coverage proving message evidence, upload receipts, operational context refs, and stale application/person-role bridge cleanup remain idempotent without duplicate projected edges.
- Talent Pool profile replay now preserves completed `candidate_ingestion.current_step` values instead of downgrading embedded, enriched, or matched rows back to the received-profile step.
- Candidate-ingestion audit now reports an unscoped zero-candidate run as `not_ready`, preventing empty local/dev data from satisfying ingestion proof gates.
- Candidate-ingestion audit now checks exact-source candidate-node projection per submitted Talent Pool candidate, so one richly parsed candidate cannot hide another candidate with no source-backed node.
- Talent Pool dev smokes now require and print the per-candidate exact-node gap count from the ingestion audit.
- Candidate-ingestion audit now verifies GitHub, LinkedIn, portfolio, and phone-screener operational context by raw intake field predicate with source refs instead of accepting aggregate context-record counts.
- Talent Pool pasted-profile R2 capture now stores private candidate metadata, matching uploaded profile objects for raw evidence provenance.
- Talent Pool pasted-profile R2 capture now uses content-hash storage keys, so replaying the same submitted profile text preserves the same raw source pointer instead of minting timestamped duplicates.
- Candidate-ingestion audit and app-dev smokes now fail profile storage keys that are not content-addressed, proving raw Talent Pool source pointers remain replay-stable.
- Candidate-ingestion audit now validates content-addressed Talent Pool profile keys with D1-compatible prefix checks instead of dynamic `LIKE` patterns, so remote app-dev proofs enforce the raw-source invariant without tripping SQLite pattern limits.
- Candidate-ingestion audit now avoids dynamic `LIKE` patterns for Talent Pool source-key checks, keeping remote D1 proofs on deterministic substring comparisons.
- Talent Pool uploaded-profile background ingestion now re-runs roleless bridge cleanup after text/document processing, preventing shared ingestion code from leaving synthetic `applications` or `person_roles` for roleless people.
- Scheduled candidate-ingestion repair now prioritizes recent document-backed and Talent Pool intake retries before stale text-smoke failures, so real uploaded candidates do not sit behind old AI discovery debris.
- Candidate document PDF/DOCX retries now reuse pre-extracted source text and bounded parser-only decomposition before AI discovery, preventing uploaded-resume repairs from stalling in full decomposition before the AI/fallback step.
- Email-less Talent Pool profile submissions and document retries now still project into canonical `people` / `workspace_people` rows using a deterministic candidate-keyed identity, so ingested candidates appear in the unified person graph without fabricating applications or person roles.
- Living-context evidence, freshness, readiness, comparison, confidence, conflict, lineage, provenance, and match-decision read helpers now resolve roleless Talent Pool `workspace_people` projections without requiring legacy application bridges.
- Talent Pool profile uploads now persist the original uploaded file as an idempotent roleless person artifact/version even when PDF/DOCX text extraction fails, preserving the immutable source blob without creating source-less profile claims.
- Candidate-ingestion audit now reports current profile upload artifact-version receipts separately from extracted source spans, so PDF/DOCX blob capture is visible without implying claim-level extraction is complete.
- Candidate-ingestion audit upload receipt counts now filter to profile-upload artifacts instead of any artifact version that happens to share the profile storage key.
- Scheduled Talent Pool repair now backfills missing profile-upload receipt artifacts from existing content-hash R2 objects and skips candidates that already have a receipt, preserving blob-source evidence without duplicating projected person edges.
- Talent Pool candidate-facing route tests now recursively reject internal candidate, person, source-span, artifact, assignment, challenge, stage, and pipeline id fields in dashboard and error responses.
- Talent Pool plain-text upload tests now prove the uploaded file receipt, extracted profile text source span, profile context record, and candidate node all trace to the current upload storage key without duplicating on replay.
- Talent Pool upload tests now prove raw R2 capture metadata for text, DOCX, and unextractable PDF files, and the DOCX test proves extracted body text, the profile-upload receipt, source span, profile context record, and candidate node all trace to the current upload storage key without duplicating on replay.
- Candidate discovery now keeps shared `CLOUDFLARE_AI_MODEL` overrides as late fallbacks instead of treating them as candidate-specific primaries, so profile ingestion starts with the fast candidate model and stale Workers AI timeout failures are eligible for replay.
- Dev candidate-ingestion repair now uses a configurable retry batch size, allowing stale AI discovery failures to burn down faster without raising production retry throughput by default.
- Candidate-ingestion audit now fails submitted Talent Pool candidates whose `candidate_ingestion` row is failed or still carries `error_text`, so stale discovery failures remain repair gaps instead of looking ready.
- Candidate-ingestion audit now verifies submitted Talent Pool candidate rows keep `resume_s3_key` aligned to the current intake `profile_r2_key`, catching stale retry/backfill source pointers.
- Candidate-ingestion audit now fails Talent Pool source spans whose stored exact text does not match the immutable artifact text at their character offsets or whose exact-text hash is invalid, catching broken provenance even when source refs exist.
- Candidate-ingestion audit now fails design-queue repo-family suggestions for PDF/DOCX Talent Pool uploads that still lack extracted source spans, catching stale generic planning hints before they imply source-backed challenge fit.
- Talent Pool PDF/DOCX uploads with no extractable source text now keep challenge-design metadata in an explicit missing-evidence state with no generic repo-family suggestion, preventing placeholder upload labels from becoming assessment planning signals.
- Talent Pool resume decomposition now anchors repeated titles/labels to the matching source occurrence and the candidate-ingestion audit fails on duplicate active candidate-node evidence or conflicting source anchors.
- Candidate discovery now tries the small current Workers AI `llama-3.2-3b-instruct` model before heavier fallback models and uses a tighter JSON output budget, and Talent Pool document retries get a bounded two-attempt AI budget so profile discovery does not fail just because the slowest model timed out first.
- Talent Pool PDF/DOCX retries now reuse pre-extracted source text and bounded parser-only decomposition before AI discovery, preserving source-backed evidence without burning the Worker background window before the model call starts.
- Talent Pool PDF/DOCX retries now use deterministic source-text pre-parsing before the shared R2 resume helper, so stalled document ingestion can reach candidate discovery AI instead of freezing in the rich resume parser.
- Talent Pool PDF/DOCX retries now bound candidate-discovery AI before source-backed fallback, so candidate-triggered retries finish inside Worker background limits instead of hanging in `discover_profile`.
- Living-context context-record source refs are now idempotent under replay/race conditions, preventing scheduled Talent Pool PDF retries from failing on duplicate source-ref inserts before candidate AI discovery can run.
- Living-context context-record entities and concepts are now idempotent under replay/race conditions, preventing overlapping Talent Pool document retries from failing on duplicate child-row inserts.
- Talent Pool PDF/DOCX resume ingestion now auto-resolves roleless Talent Pool person identity inside the shared R2 resume helper, preventing any unguarded caller or stale retry from recreating legacy application/person-role rows before a real role-backed process exists.
- Scheduled Talent Pool repair now removes generated application/person-role rows for roleless Talent Pool candidates, keeping Talent Pool evidence separate until a real role-backed process exists.
- Talent Pool ingestion retries and scheduled repair now restore source-backed GitHub/LinkedIn/portfolio and phone-screener operational context from the original intake row before or alongside profile AI/evidence ingestion.
- Talent Pool candidate-ingestion audit now reports challenge assignment rows that lack repo URL or PR number separately from PR-backed ready assignments, so partial assignment state remains an assessment setup gap instead of implied readiness.
- Roleless Talent Pool identity repair now detaches and removes synthetic legacy application/person-role bridges, and scheduled living-context backfill skips roleless Talent Pool intakes so cron cannot recreate those edges.
- Scheduled Talent Pool ingestion repair now recognizes the initial `talent_pool_profile_received` step and replays `.txt` Talent Pool sources through text ingestion instead of the document parser.
- Stalled Talent Pool profile receipts now replay from their original R2 source, including pasted `.txt` intakes, so candidate AI/evidence ingestion cannot remain indefinitely at `talent_pool_profile_received`.
- Talent Pool profile submit/upload now repairs the roleless person projection, so dev-seeded and legacy `/talent/:token` candidates upsert one canonical `people`/`workspace_people` identity without fabricating role-backed applications or person roles.
- The People list now includes canonical `workspace_people` Talent Pool members and suppresses same-email/contact duplicates, so ingested Talent Pool candidates appear in the unified person list instead of only in candidate-specific surfaces.
- People/person source search, evidence timeline, and evidence-depth reads now resolve canonical person ids as well as legacy contact ids, so roleless Talent Pool candidates returned by the unified People list keep their source-backed evidence tools.
- Talent Pool DOCX uploads now extract OOXML body text and run the same candidate-ingestion and living-context source projection path as PDF uploads instead of only storing the file.
- Added `candidate-ingestion:audit` to verify Talent Pool raw intake capture, candidate-ingestion state, exact source spans/source refs, roleless person projection, duplicate projected edges, and source-less positive candidate/person claims.
- Talent Pool pasted/decoded text intake now creates an idempotent `talent_pool_profile_intake` person context record backed by the exact submitted text source span without deriving skills or readiness claims.
- Talent Pool profile uploads now use content-hash storage keys and pass the roleless person identity into PDF/DOCX resume context projection, so upload replay does not duplicate person evidence or create application/role rows before a role-backed process exists.
- Talent Pool GitHub, LinkedIn, portfolio, and phone-screener intent fields now project into source-backed operational context records with exact intake field spans, and the candidate-ingestion audit fails if those raw fields remain unprojected.
- Talent Pool profile submit/upload now creates an idempotent exact-source `TalentPoolProfileIntake` candidate node from submitted profile text, and the candidate-ingestion audit fails when submitted intakes lack exact-source candidate-node projection.
- Talent Pool background text/PDF/DOCX decomposition now avoids legacy application/person-role mirroring and skips parser-only resume nodes that cannot be tied to an exact source quote.
- Talent Pool profile uploads now link extracted profile text source spans to the uploaded profile storage key when extraction succeeds, and the candidate-ingestion audit flags PDF/DOCX profile keys that lack extracted source spans.
- Recruiter Talent Pool candidate living-context reads now resolve active roleless `workspace_people` projections directly for graph/search/timeline/evidence-depth and avoid creating legacy application or candidate-role edges just because a recruiter opens the person evidence.

### Added — Open-source assessment setup

- Standalone `OPEN_SOURCE_BUG_FIX` matching now materializes the selected repo/PR into a source-backed assessment session from a production-ready review challenge packet before returning a ready challenge, and fails closed to the candidate-safe intake handoff when packet provenance is incomplete.
- The open-source workspace smoke now allows matched repo challenge packets to use their real source-backed task titles instead of expecting the manual smoke fixture title.
- `assessment-evidence:replay` now supports `--missing-events-only`, projecting only assessment events that still lack person context so active `IN_PROGRESS` sessions can be repaired without rebuilding an entire large session transcript.
- `assessment-evidence:audit` and `assessment-evidence:replay -- --remote --all-missing` now use the same real-candidate eligibility for person projection, so old synthetic smoke rows with dangling candidate ids do not masquerade as repairable person-context debt.
- `assessment-evidence:replay -- --remote --all-missing` now supports `--progress` and repeatable `--exclude-state <STATE>` filters with per-session state/missing-event counts, so app-dev historical backfill can report the current session and skip active `IN_PROGRESS` assessments while completed rows are repaired.
- `assessment-evidence:replay -- --remote --all-missing --summary` now emits compact bounded-backfill proof with processed session ids, success/failure counts, context/source-ref totals, missing projection counts, and matching effects for app-dev replay batches.
- `assessment-evidence:replay` now emits a DoD answer block covering what happened, who acted, source proof types, derived claims, missing person projections, and matching effects for the replayed assessment.
- `assessment-evidence:replay` can now run `--all-missing --limit <n>` to backfill candidate-backed assessment sessions with missing person projections and report matching effects for each replayed candidate.
- Open-source assessment session creation and replay now snapshot candidate profile evidence into the assessment spine with exact `candidate_profile` source refs, so profile context can be replayed into living context alongside challenge/workspace evidence.
- Recruiter open-source assessment invites now show a live challenge-packet checklist for repo, exact base commit, task, success criteria, and expected evidence before creation, making manual tasks visibly concrete instead of a loose repo dump.
- Added `npm run smoke:open-source-workspace-dev` as the explicit dev proof command for the real open-source bug-fix workspace path, covering room launch, source-backed workspace finalization, commit evidence, and evaluator readiness.
- Added explicit app-dev deployment scripts for `pipe-api-dev`, `pipe-app-dev`, and the assessment room, including an explicit room-dev Wrangler target, so manual assessment fixes ship to the same dev surfaces used by smoke tests.
- Added `npm run assessment-evidence:audit` plus the assessment evidence ingestion audit contract, reporting captured, projected, missing, duplicated, source-less-positive, and unprojected raw assessment evidence across the required ingestion families.
- Added `npm run assessment-evidence:replay -- --remote --session-id <id>` to replay one assessment session into living context and print interaction/context/source-ref proof counts for dev verification.

### Added — CODE_REVIEW assessment runtime

- Candidate CODE_REVIEW challenge pages now render a candidate-safe source-backed task packet with repository, base commit, task, success criteria, expected evidence, constraints, and missing packet fields without exposing internal packet or source-span ids.
- Added an internal living-context match-quality evaluation gate with compact match reports, labelled contrast cases, source-backed PR checks, and decision-weighted rematch exclusions, harvesting PR #171 backend primitives without exposing graph cockpit or matching diagnostics to candidates.
- The internal match-quality evaluation CLI can now run against frozen `evaluation_corpora` rows via `--corpus-id` as well as compact JSON files, adapting existing candidate-role-challenge labels into the CODE_REVIEW packet-quality gate.
- CI matching-evaluation readiness can now target a dedicated D1 database and rollout stage via `MATCHING_EVALUATION_D1_DATABASE_ID` and `MATCHING_EVALUATION_STAGE`, keeping app-dev CODE_REVIEW quality proof separate from the mostly empty production D1 while preserving the same frozen-corpus gate.
- Draft corpora seeded from real match runs now persist through the frozen `evaluation_corpora` schema with immutable hashes, and seeded draft labels no longer count as expert labels until reviewer/source provenance is attached.
- The internal evaluation-corpus seed endpoint now reports corpus hash, draft/expert/synthetic label counts, production-readiness failures, and the required next action so operator-created match corpora cannot be mistaken for expert-labelled gates.
- Production match-quality corpora now require each expert label to include a human rationale in addition to reviewer/source provenance, preventing metadata-only labels from opening CODE_REVIEW rollout gates.

### Fixed — CODE_REVIEW assessment runtime

- Standalone CODE_REVIEW ingestion now retries stale or failed candidate-evidence runs from the original resume source, remaps deprecated Workers AI models to the current default, and preserves richer raw review evidence for repo matching.
- Standalone CODE_REVIEW status checks now queue source-backed PR assignment when candidate evidence is already ready, keeping `/assess` on the safe profile-received handoff while preventing ready candidates from staying idle.
- Standalone text-intake CODE_REVIEW invites now attempt source-backed PR assignment immediately after resume decomposition produces matchable evidence, so app-dev auto-match can unblock without waiting for the slower discovery/profile tail to finish.
- Labelled match-quality evaluations now compute and enforce expected reason categories, so a case cannot pass solely because the verdict is correct when the rationale is wrong.
- Candidate `/assess` pages now fail closed to the safe profile-received handoff when a standalone code review leaks a `WELCOME` plus `WAITING_FOR_MATCH` stage, preventing the old matching dashboard from resurfacing while challenge readiness is handled upstream.
- Standalone CODE_REVIEW intake no longer waits for full candidate profile ingestion before responding, keeping `/assess` on a bounded source-evidence handoff while profile discovery continues in the background.
- Standalone CODE_REVIEW assignments can now repair a missing scheduled-interview repo/PR cache from the latest passed source-backed match run, so candidates do not stay on the profile-received handoff after a valid PR packet was already selected.

### Fixed — Open-source assessment progress

- Text-intake candidate-ingestion retries now use the same bounded parser-only path as live `/assess` intake, preventing retries from stalling in heavy resume decomposition before AI discovery can finish or fall back.
- Scheduled candidate-ingestion repair now only retries real stalled ingestion pipeline steps and prefers newest active stalls before old failed-output repairs, avoiding accidental Talent Pool marker retries and keeping current candidate tests moving.
- Scheduled candidate-ingestion repair now prioritizes stalled in-progress rows before older failed-discovery backlog entries, so active candidates do not wait behind historical smoke-test repair debt.
- Candidate discovery AI now shares one strict wall-clock budget across model fallbacks, so a malformed first model response cannot start a second long call that gets cancelled by Worker background limits and leaves ingestion stuck in `discover_profile`.
- Candidate discovery ingestion now tries a bounded sequence of current Workers AI models, stops cleanly after an application timeout, unwraps object-shaped provider responses, and records per-attempt telemetry before falling back to source-backed parsing, so dev no longer silently gives up or gets stuck after one slow or malformed model response.
- LLM usage accounting now includes the current Workers AI `@cf/zai-org/glm-4.7-flash` default so candidate-ingestion metering does not fail on the replacement model.
- Standalone assessment text intake now skips hot-path per-node embeddings after source-backed resume evidence is persisted, giving candidate-profile AI discovery time to complete before Worker background execution is cancelled.
- Standalone assessment text intake now skips post-decomposition graph maintenance in the request hot path, letting source-backed evidence persist before candidate-profile AI discovery starts.
- Standalone assessment intake now starts text-based candidate ingestion immediately and waits only for a bounded source-evidence handoff, preventing the candidate response from blocking on slower AI profile discovery.
- Standalone assessment candidate ingestion now makes the parser-only hot path truly skip Neo4j maintenance and persists a clearly labelled source-backed fallback profile when candidate-discovery AI returns empty or invalid output.
- Standalone CODE_REVIEW text intake now awaits candidate profile ingestion with a bounded Candidate Discovery AI timeout, avoiding cancelled `waitUntil` profile jobs while keeping matching follow-up in the background.
- Standalone CODE_REVIEW parser-only intake now caps hot-path evidence nodes and skips immediate living-context mirroring, keeping source-backed candidate evidence durable without spending the whole request on projection work.
- Standalone assessment source-backed matching now runs as a separate background action after resume evidence is ready, so candidate-profile AI discovery is no longer blocked behind deterministic repo matching.
- Scheduled candidate-ingestion retries now avoid fragile D1 `LIKE` pattern chains and classify retryable AI/profile failures in TypeScript, preventing the dev retry cron from crashing while it repairs stale rows.
- Candidate evidence ingestion now uses a structured-output-friendly Workers AI default, removes fenced JSON from the candidate-discovery prompt, unwraps nested Workers AI responses, retries failed discovery-output contracts, and exposes source-backed resume evidence before bounded embedding work can stall the `/assess` handoff.
- Batched recruiter interview-list assessment progress summaries now use explicit typed row projections, keeping Worker strict typing green for the list-card performance path.
- Recruiter interview lists now load assessment progress from batched summary queries instead of hydrating full per-session evidence detail for every card, preserving task/commit/evaluation signals while reducing list-page D1 work.
- The assessment evidence audit now limits unscoped person-projection and duplicate checks to assessment-origin interactions, avoiding false duplicate reports from unrelated meeting-room context while still flagging candidate-backed raw assessment events that need replay.
- Living-context scheduled backfill now recovers stale `running` checkpoints before selecting ready tasks, so interrupted assessment evidence replays retry instead of freezing app-dev assessment projection.
- Assessment evidence audits can now be scoped to one assessment session, report absent families as coverage gaps by default, and reserve failures for missing sessions, source-less positive claims, duplicate projected edges, or captured raw events that did not project to person context.
- Assessment-to-living-context ingestion now projects evaluator reports themselves into person context with exact `assessment_evaluation_report` source refs, so report summaries are rebuildable person evidence rather than only assessment-scoped context.
- Assessment evidence replay now preserves original `review_challenge_packet` refs when optional packet tables are absent, preventing one missing projection table from blocking later commit, diff, test, AI, report, or human-decision evidence from reaching person context.
- The assessment evidence ingestion audit now checks explicit context record types per evidence family instead of deriving them from event kind names, reducing false captured/projected classifications.
- The assessment evidence ingestion audit now separates raw assessment-session context record types from person-projected context record types, so `assessment_commit_submission` raw capture cannot be mistaken for `assessment:commit_submission` person evidence.
- Recruiter detail smoke tests can now optionally open the delivered candidate assessment/workspace link from the detail page, proving disposable app-dev invites hand off to the candidate CODE_REVIEW or workspace surface instead of only verifying recruiter-side projections.
- Conservative fallback evaluator reports now preserve source-backed AI-use observability and candidate-approved upstream PR tracking, so open-source assessments can show whether AI help and upstream contribution evidence were actually captured.
- Assessment progress commit projections now include source-backed upstream PR URL and consent flags, so recruiter readouts can distinguish local workspace-only commits from candidate-approved upstream PRs.
- Candidate RPC assessment progress now returns the same upstream PR tracking fields as room and recruiter progress APIs.
- CODE_REVIEW invite tests now assert app-dev assess-link delivery without hard-coding Basic Auth credentials that CI masks.
- Dev room invite coverage now proves app-dev can generate room-dev links with the separate live room Basic Auth credentials instead of accidentally reusing app-dev credentials that the room worker rejects.
- Assessment progress now treats real agent bridge prompt, blocked-prompt, and response source refs as AI-use transparency, and recruiter surfaces label those refs as AI prompts, blocked AI prompts, and agent responses instead of raw enum names.
- Devin-agent chat smoke validation now loads dev env files, supports separate app-dev and room-dev Basic Auth credentials, explicitly launches the real `devin` bridge, probes bridge status on WebSocket open, and can prove the honest `auth_needed` state without fake replies.
- Interview cards now expose stable smoke-test metadata for interview id, interview type, and candidate email, and the deployed open-source workspace smoke verifies the post-evaluation list card shows the assessment mode, task, repo/base, source-backed commit trust, final decision, and next action.
- The deployed open-source workspace smoke now opens the candidate room before launch, waits for either the task brief or the no-camera/no-mic recovery path, and requires the assessment task brief to render the concrete repo, base commit, task, success criteria, and expected evidence, catching blank or misleading candidate rooms before dev is called healthy.
- Recruiter assessment details now show a reviewer receipt after a human decision is recorded, tying the final decision to the reviewer, reviewed commit, branch/repo, recorded notes, and assessment-report source refs.
- Recruiter assessment details now show an explicit source-backed diff row for workspace-only finalizer commits, so reviewers know the diff is captured even when no external GitHub compare link exists.
- Recruiter assessment details no longer invent GitHub compare links for workspace-only finalizer commits; external compare links now require a real GitHub commit URL while source-backed diff evidence remains reviewable.
- The app-dev open-source workspace smoke now verifies the recruiter detail projection exposes the evaluated, trusted, challenge-bound submitted commit plus reviewable source-backed diff, test, and commit evidence.
- The app-dev open-source workspace smoke now asserts the stable `workspace_captured` and `bound_to_assigned_challenge` recruiter assessment contract names.
- The app-dev open-source workspace smoke now retries the real workspace launch once when the dev container lands in Cloudflare's transient container-not-running state.
- Interview assessment details now show a direct GitHub compare link from the assigned base commit to the submitted assessment commit when source-backed commit metadata is available.
- Recruiter interview lists now include a product-mode filter for standard calls, code review, dev-container, and open-source bug-fix assessments, making real assessment sessions easier to find without mixing them with calls.
- Recruiter interview cards now show assessment room state alongside workspace state, including active rooms and waiting guests, so live assessment status is visible without opening the detail page.
- CI now runs the assessment-room unit tests inside the room package instead of sweeping them through the root app Vitest runner, preserving room evidence-capture coverage without duplicate-React hook failures.
- Person-profile workspace assessment smokes now assert assessment evidence, human decision, and source proof instead of requiring candidate-to-repo match proof when no match provenance exists.
- Recruiters can no longer record final human assessment decisions from diagnostic-only evaluator reports; the app now requires a completed source-backed `EVALUATED` report before closing the assessment loop.
- Open-source assessment evaluation now produces a conservative source-backed fallback report when the AI evaluator returns no usable claims, keeping real challenge, commit, diff, test, and workspace evidence reviewable instead of blocking the session as diagnostic-only.
- Open-source assessment evaluation now also falls back to a conservative source-backed report when Workers AI returns unparseable text after complete challenge, commit, diff, and verification evidence is captured, avoiding false `AI_DEVELOPER_UNAVAILABLE` states.
- Interview assessment readouts now label conservative fallback evaluations as requiring human review instead of presenting source-backed but unproven commits as positive hiring decisions.
- Assessment-room workspace layouts now keep a persistent `Submit Work` control in the bottom bar, so candidates can finalize the real workspace commit without hunting through tool tabs.
- Role-backed CODE_REVIEW matching now proceeds once active candidate ingestion has advanced past resume decomposition and produced matchable source-backed evidence, while still deferring candidates with no usable evidence.
- Person-profile code-review decision cards now label proven match bridges as source-backed matches instead of vague bridge counts.
- Recruiter interview cards now translate source-backed assessment evaluator recommendation enums into hiring-manager-readable next actions.
- CODE_REVIEW readiness diagnostics now distinguish active resume decomposition from terminal evidence gaps without blocking matching once usable evidence exists.
- Assessment progress APIs now filter legacy evaluator claims without exact source refs at the shared backend projection, so candidate, room, and recruiter clients receive the same source-backed claim previews.
- Assessment-to-living-context ingestion now skips evaluator claims with no exact source refs instead of fabricating claim-narrative provenance for the person graph.
- Candidate dev-container panels now explain the trusted workspace finalizer path and show recovery commands when uncommitted workspace changes block finalization.
- Recruiter interview cards now show source-backed evaluator claim previews, diagnostic evidence types, and missing evidence-coverage gaps while filtering source-less positive claims from the card.
- Challenge-packet summaries now avoid inventing structured locator fields from raw exact text when persisted locator metadata is missing, preserving the distinction between source evidence and normalized packet fields.
- Matched open-source challenge packets now carry a deterministic workspace verification command, so matched-repo dev-container finalization captures `test_run` evidence instead of falling back to a verification gap.
- The app-dev recruiter assessment smoke can now submit a real human decision from the evaluated workspace page, proving the assessment loop reaches reviewer closure instead of stopping at AI evaluation.
- Candidate dev-container commit panels now block manual commit submission and workspace finalization until the assigned source-backed challenge packet is complete, preventing standalone assessment paths from accepting unreviewable work.
- Person-profile code-review decision cards now show an explicit `Usable signal`, `Calibration needed`, or `Not ready` state instead of always using a success icon, so hiring managers get a truthful first read before scanning the evidence.
- Recruiter interview cards now render the assessment readiness contract as a required/confidence proof checklist, making missing challenge, commit, workspace, transcript, AI-use, or verification evidence visible without decoding raw source-ref counts.
- Assessment-room source now has a regression guard against reintroducing retired novelty-room branding or affordances, keeping the room focused on the core candidate assessment product.
- Manual open-source challenge packets can now carry a trusted verification command into the dev-container finalizer, so source-backed workspace submissions produce `test_run` evidence from challenge config instead of candidate-supplied request data.
- Repo-task commit submissions now require a complete source-backed challenge packet before accepting candidate work, preventing incomplete assignments from becoming review evidence.
- Dev-container workspace launch now fails closed unless the room has a GitHub PR or a complete source-backed open-source challenge packet, preventing repo-only matches from becoming unreviewable candidate work.
- Person-profile route-state proof summaries now require parsed source proof items before they appear in the decision card.
- Person-profile next-action CTAs now suppress duplicate code-review assessment creation when the selected decision is still waiting on candidate review evidence.
- Workspace assessment work packets now quantify captured AI prompt and agent-response evidence, so hiring managers can distinguish observed AI assistance from unobserved AI use.
- Recruiter interview cards now flag incomplete open-source challenge packets, including the missing packet fields, so a partially assigned repo task cannot look ready for candidate work.
- Assessment room identity tests now assert PIPE assessment-room metadata and supported work surfaces without preserving discarded product phrasing in fixtures.
- Candidate assessment rooms now show the workspace finalizer trust contract before submission, making it clear the trusted path reads git HEAD inside the container, verifies challenge anchors, and stores source refs for commit, diff, tests, and workspace state.
- Recruiter interview cards now show commit trust separately from the short SHA, including workspace-capture integrity and whether the commit is bound to the assigned open-source challenge packet.
- Dev-container assessment room progress coverage now labels captured agent evidence as `AI use`, matching recruiter summaries and making transparent AI assistance visible in-room.
- Dev-container assessment room progress coverage now labels captured tooling as `tool activity`, matching recruiter summaries and avoiding vague room-activity proof.
- Assessment welcome-screen source comments now use neutral assessment wording, keeping the codebase aligned to the core candidate-test product.
- Recruiter interview cards now surface source-backed verification gaps in the evidence summary when candidates submit a missing-test note, so ready-for-evaluation assessments do not hide absent test output.
- Dev-container assessment room status strips now surface verification gaps in live progress coverage, keeping hosts and candidates aligned on missing test proof before evaluation.

### Fixed — Route performance

- Recruiter API and SSE hooks now call PIPE auth hooks unconditionally and switch token behavior internally, fixing CI hook-order lint failures while preserving dev-proxy auth bypass.
- Scheduled interview list responses now enforce a 20-row newest-created first page and the recruiter dashboard loads older interviews on demand, reducing `/interviews` first-paint work before assessment progress enrichment.
- Contacts list responses are now paginated by default and the People page loads additional pages on demand, preventing large relationship graphs from shipping unbounded multi-megabyte `/api/v1/contacts` payloads.
- The People page now uses the shared cached recruiter API client hook, avoiding a one-off Clerk client path while keeping paginated contact loads on the same auth/cache behavior as other recruiter surfaces.

### Added — Route performance

- Added an API route benchmark harness for local Worker routes, including optional local D1 seeding, expected-status checks, latency thresholds, and a `bench:routes` package script.
- Expanded the API route benchmark harness with source-route coverage reporting and additional read-safe route families across ingestion, scheduling, repo discovery, living context, and admin diagnostics.
- Added coverage-only route inventory mode and benchmark specs for safe missing-ID, candidate artifact validation, meeting-room, phone, GitHub, and internal evidence diagnostic paths.
- Expanded the route benchmark inventory with opt-in mutation probes and unauthorized candidate/runtime endpoints so assessment-room regressions are visible without mutating data by default.
- Added bounded dry-run contracts for heavy living-context maintenance and culture calibration routes, bringing the opt-in route benchmark inventory to full discovered-handler coverage without launching backfills or AI calibration calls.
- Heavy living-context maintenance triggers and culture scorer calibration now queue by default with explicit `waitForResult` synchronous mode, keeping operator routes below the route benchmark latency budget.
- The app-dev CODE_REVIEW reliability loop now runs a timeout-bounded real ready-submit smoke separately from the blocked matching matrix, proving both viable assessment submission and honest blocked-state behavior without hanging indefinitely.
- The deployed CODE_REVIEW smoke now waits for recruiter-detail projections with bounded API requests before launching Playwright, then retries once after projection readiness so app-dev verification fails with a useful reason instead of hanging on stale recruiter state.
- The app-dev CODE_REVIEW reliability loop now parses the blocked-profile matrix summary from its explicit marker instead of accidentally treating a nested profile proof as the matrix result.
- The deployed CODE_REVIEW recruiter smoke now asserts the pending-assignment person profile says to wait for candidate review and withhold hiring decisions until source-backed review comments arrive.
- Added CODE_REVIEW commit-submission regressions proving candidate commit URLs must belong to the assigned repository or declared fork before they can count as assessment evidence.

### Fixed — CODE_REVIEW assessment runtime

- CI matching-evaluation readiness now treats missing production secrets or corpus configuration as a loud non-blocking artifact on `main`, while still failing CI for configured production readiness failures.
- CODE_REVIEW app-dev smokes now fail immediately if `/rpc/get-challenge` returns candidate-visible `WAITING_FOR_MATCH`, ensuring transient matching dashboards cannot pass the ready-assessment proof after a later assignment appears.
- The role-backed app-dev CODE_REVIEW smoke script now expects the ready automatic-match path, keeping the packaged proof command aligned with the current `/assess` behavior while the blocked smoke remains the explicit no-assignment handoff gate.
- Recruiter interview list and detail projections now use the candidate's role-backed CODE_REVIEW assignment as the effective repo/PR when the scheduled interview row has not been denormalized yet, keeping the hiring-manager readout aligned with the candidate assessment runtime and preserving `candidate_challenge_assignment` as the setup source.
- The deployed CODE_REVIEW smoke proof now reports recruiter assessment setup status, kind, source, repo, and PR from the live detail projection so assignment-source drift is visible in CI/live verification output.
- Role-backed CODE_REVIEW matching now proceeds whenever resume decomposition has produced matchable source-backed nodes, even if the async ingestion row still says `pending/decompose_resume`; candidates with no usable evidence still receive the safe profile-received handoff.
- The deployed CODE_REVIEW auto-match smoke now waits through the candidate-safe `Profile received` handoff before failing with a clear timeout when no upstream challenge finalizer assigns a ready CODE_REVIEW, matching the deferred-matching product boundary without reviving the candidate waiting screen.
- Active CODE_REVIEW evidence ingestion now stays a pending auto-refresh diagnostic while repo matching is deferred, instead of being marked as a blocked/terminal challenge state.
- Pipeline CODE_REVIEW gates now defer deterministic repo matching while candidate evidence ingestion is still active, preventing partial resume spans from producing false `NO_ROLE_SAFE_CHALLENGE` match runs before decomposition finishes.
- Person profile code-review decisions now ignore evaluator claims without source refs, so source-less positive praise cannot become a strength, basis item, or person-level hiring signal.
- Interview detail hiring-manager readouts now hide evaluator claims with zero source refs, matching the interview-card rule that source-less positive praise must not become recruiter-facing proof.
- CI now treats a configured production matching-evaluation readiness failure as a blocking CODE_REVIEW gate and fails pushes to `main` when the required Cloudflare secrets or corpus id are absent, while pull requests still emit a non-blocking `not_configured` artifact for missing secret contexts.
- Match-quality bridge repairs now tolerate legacy/local fixtures without newer candidate-node projections while preserving strict source-backed challenge packet hash and exact-text validation.
- Assessment-to-living-context backfills now normalize legacy review-challenge packet refs to the stored immutable packet JSON before writing context records, keeping old event rows source-backed under stricter provenance validation.
- Candidate-discovery model-key attribution now falls back to the provider name when a local/test provider omits a model string, preventing discovery fixtures from crashing before evidence decomposition.
- Standalone CODE_REVIEW E2E fixtures now seed candidate-scoped repos, PRs, and concepts with a weaker comparator packet, keeping automatic match contrast proof deterministic even when local D1 contains stale packets from prior runs.
- Candidate-facing CODE_REVIEW RPCs now return the `Profile received` / `candidate-intake-queued` handoff when no source-backed PR is ready, instead of exposing `WAITING_FOR_MATCH` through direct submit or review-session calls.
- Review-session init, explainer, and message endpoints now share the complete `candidate-intake-queued` handoff payload when source-backed PR packet proof is missing, preventing partial assessment runtime states from reviving the matching screen.
- Scheduled interview list migrations now ship D1 indexes for newest-first owner paging plus latest meeting, guest presence, and workspace-session lookups, reducing recruiter `/interviews` load time as assessment history grows.
- The video-room test suite no longer carries retired novelty-room wording; assessment room identity is covered through positive PIPE assessment metadata and surface expectations.
- Interview related-context previews now prioritize linked follow-ups, technical assessments, and transcript-backed conversations before lower-priority related rows, keeping the single-meeting page useful without blending every person interaction into the current meeting.
- Person-profile relationship timelines now classify invite/email rows as operational evidence and prioritize code-review, call, and resume evidence ahead of lower-priority operational rows, keeping hiring-manager context from being buried under delivery noise.
- Interview detail match explanations now label manual assignment-only PR evidence as `Assignment proof` instead of `Valid because`, preventing recruiter-selected PRs from being mistaken for automatic candidate-repo fit proof.
- The app-dev CODE_REVIEW recruiter smoke now expects manual override PRs to show `Assignment proof`, while keeping `Valid because` reserved for source-bridged automatic candidate-repo matches.
- Standalone CODE_REVIEW `/assess` now fails closed to the candidate-safe `Profile received` handoff if a regressed stage config tries to render `WAITING_FOR_MATCH`, preventing the old matching dashboard from reappearing in the assessment runtime.
- Person-profile CODE_REVIEW decisions now show a concise score-validity readout that explains whether a score is usable because rubric coverage, review transcript, repo challenge, and candidate/repo match proof are present, or withheld because a required proof link is missing.
- CODE_REVIEW interview detail pages now render a compact decision cockpit above invite/progress mechanics, so hiring managers see outcome, validity, risk, and next action before operational link state.
- Blocked CODE_REVIEW app-dev smokes now open the candidate `/assess` page and assert the `Profile received` handoff directly, including negative checks against the old matching dashboard copy.
- Deployed CODE_REVIEW smoke API calls now enforce configurable per-attempt abort timeouts (`CODE_REVIEW_SMOKE_REQUEST_TIMEOUT_MS`), so blocked-path proofs fail with a useful route timeout instead of sitting silently during app-dev/API stalls.
- CODE_REVIEW recruiter readouts now treat failed scoring as `Score unavailable` with retry/manual-review guidance instead of saying the assessment is still scoring.
- Standalone roleless CODE_REVIEW auto-matches now accept the explicit `contrast_separation_not_required_roleless` quality check, allowing source-backed roleless matches to advance without a fake role contrast requirement.
- Standalone `/assess` text-intake submissions now queue CODE_REVIEW evidence ingestion without running repo matching inside the candidate response, returning the candidate-safe queued handoff unless a source-backed PR assignment was already ready while scheduling post-ingestion source-backed assignment work in the background.
- The deployed open-source workspace smoke now records a recruiter human decision after source-backed AI evaluation and requires the recruiter projection to expose that decision with assessment-report source refs.
- The deployed open-source workspace smoke now opens the app-dev recruiter detail page and verifies the reviewer receipt is visible with the final decision, assessment-report anchor, reviewed commit, repo/branch, and no raw reviewer ID leak.
- The deployed open-source workspace smoke now retries the source-backed evaluation start once after a transient 500 while preserving hard failure if the evaluator remains unavailable.
- Candidate commit-submission clients now reject optional commit URLs outside the assigned repository or declared fork before submission, matching the server-side assessment proof invariant.
- The assessment-room task brief now shows a source-backed submission status after a workspace commit is captured, making the candidate final state clear without exposing recruiter-only scoring.
- App render errors from stale post-deploy dynamic chunks now auto-reload once per chunk URL before showing the manual recovery screen, reducing candidate/recruiter dead ends during CODE_REVIEW deploy rollovers.
- Legacy review submission panels now require a connected submit service before showing success, removing the fake delayed success path from assessment UI code.
- Person-profile CODE_REVIEW recommendations now require parsed candidate/repo match provenance before showing positive advance language, so assignment-only or stale route-state scores stay in missing-evidence calibration.
- Recruiter interview cards now surface challenge-packet success criteria and expected evidence alongside repo, base commit, and task so open-source assessments read as concrete work packets before the candidate starts.
- Commit-submission proof checklists now label captured tooling as `Tool activity` instead of carrying stale interaction language from the retired experiment.
- Person-profile CODE_REVIEW route-state source proof summaries can no longer prove candidate/repo match alignment by themselves; candidate/repo proof must come from parsed proof items or the summary is recomputed.
- Person-profile selected-assessment route-state handoffs now sanitize source-ref counts, evidence snippets, evaluator claims, and challenge URLs before deriving workspace-assessment proof, preventing stale route state from crashing or inventing assessment evidence.
- Person-profile CODE_REVIEW selected-decision route state now derives displayed proof counts from parsed proof items unless candidate/repo bridge proof is present, and empty proof drawers explain that no source proof survived the handoff.
- Person-profile CODE_REVIEW route-state handoffs now only preserve `Source-backed match` basis claims when the selected decision also carries candidate/repo bridge proof text, otherwise match proof is downgraded to missing evidence.
- Person-profile CODE_REVIEW route-state handoffs now sanitize stale or malformed selected-decision payloads before rendering, preventing crashes and defaulting untrusted match proof to missing evidence.
- Removed the obsolete proactive assistant prompt/tray protocol from the assessment room runtime, Durable Object replay, session-event ingestion, and graph projections so only real workspace bridge evidence is accepted for agent actions.
- Interview detail CODE_REVIEW handoffs now detect recruiter manual assignments from live assessment setup and matcher summary metadata, keeping person-profile match proof calibrated even when compact match projections omit validator mode.
- Interview-to-person CODE_REVIEW handoffs now preserve manual assignment calibration by passing "Assignment evidence only" as the match-proof basis instead of treating an assessment-quality score as candidate-fit proof.
- Person-profile CODE_REVIEW decisions now require rendered candidate and repo source-bridge evidence before labeling a PR assignment as a source-backed candidate-repo match, otherwise the readout calls it assignment evidence and surfaces the missing bridge.
- Workspace finalization now runs only the container-configured verification command for `test_run` evidence and records a verification gap when none is configured, preventing candidate-selected commands from satisfying assessment proof.
- Candidate and recruiter CODE_REVIEW surfaces now consistently describe implementation-author replies instead of exposing AI-developer or generic pushback wording in default instructions and trust signals.
- Workspace finalization now canonicalizes and verifies the checked-out git remote or configured challenge repo before emitting commit evidence, blocking browser-supplied repository spoofing.
- CODE_REVIEW hiring readouts now avoid implying source proof exists when no rendered evidence bridge is available, and describe review pushback as implementation-author replies instead of internal developer-agent wording.
- Commit submission now rejects optional upstream PR links unless they belong to the assigned repository and include exact upstream pull-request source evidence, preventing unrelated PRs from being stored as assessment proof.
- Recruiter invite panels now distinguish standalone CODE_REVIEW `/assess` links from open-source/dev-container workspace room links, preventing room-backed assessments from being described as one-use assess links.
- Person CODE_REVIEW decision cards now render an explicit no-blocking-gap message when a selected assessment has no missing-context items instead of leaving hiring managers with an empty section.
- Manual PR CODE_REVIEW scores now show assignment-calibration validity and fairness-before-advance recommendations instead of generic usable/advance wording, preventing hiring managers from reading a recruiter-selected PR as automatic candidate-fit proof.
- Interview detail pages now always show the single-meeting/person-rollup boundary cue, even before living-context evidence exists, so sparse CODE_REVIEW records do not look like they contain every related meeting.
- Person-profile CODE_REVIEW browser smoke now asserts the relationship timeline boundary copy, keeping same-person interactions useful as context without implying the profile owns every meeting row by default.
- CODE_REVIEW recruiter browser smoke now proves interview and person source-proof drawers stay collapsed by default, preserving source traceability without reopening noisy raw evidence in the hiring-manager readout.
- Person-profile CODE_REVIEW browser smoke now asserts the deployed hiring cockpit renders recommendation, assessment validity, uncertainty, missing context, and next action before accepting a person-rollup proof.
- Recruiter CODE_REVIEW detail smoke now browser-asserts the hiring-manager trust model, including assignment trust, score validity, risk, and next action, so matched pages cannot silently fall back to unknown assignment provenance.
- Hardened the deployed same-person CODE_REVIEW boundary smoke to wait for the hydrated person rollup and verify completed code-review evidence separately from related meeting context.
- Removed tracked root `.wrangler` local D1 state and ignored the repo-root Wrangler cache so stale local room data cannot remain in the source tree.
- Added a named deployed person-rollup boundary smoke that creates a completed CODE_REVIEW plus a second same-person unsubmitted CODE_REVIEW, then proves the profile recommendation stays anchored to the completed scored review instead of blending related match-only evidence.
- Pipeline-backed CODE_REVIEW matching now applies the same candidate-safe quality gate as standalone matching before assigning a PR, so role-backed near-ties or `NEEDS_REVIEW` matches remain queued for recruiter review instead of being served to candidates.
- Added a named role-backed deployed CODE_REVIEW smoke that proves role-backed no-assignment candidates still receive the safe `PROFILE_RECEIVED` handoff instead of a candidate-visible matching loop.
- Added a legacy D1 repair migration for `candidates.pipeline_id` so app-dev can create pipeline-free standalone CODE_REVIEW assessment invites.
- The deployed `/assess` smoke suite now creates two real app-dev CODE_REVIEW invites and proves opening token B after token A in the same browser resolves/stores candidate B before either invite is claimed.
- The deployed CODE_REVIEW assess smoke now treats non-submit mode as ready once the recruiter detail has an active matched assignment, while full-submit mode still requires completion, submission, and scoring proof.
- Added a named deployed blocked-path CODE_REVIEW smoke command that proves standalone assessments stop at `PROFILE_RECEIVED` / `candidate-intake-queued` instead of showing a candidate-visible matching loop.
- Recruiter detail smokes now verify the person profile does not overclaim an active, unsubmitted CODE_REVIEW as a person-level technical decision; full-submit mode still verifies the completed decision card.
- The `/assess` browser smoke suite now proves same-browser stale candidate sessions are discarded when a different invite token is opened, so token B resolves and stores candidate B instead of leaking token A state.
- Person-profile CODE_REVIEW rollups now bind score, transcript, and match proof by shared session or interaction before presenting a current recommendation, preventing a newer related match-only interview from being blended into an older completed review score.
- The recruiter CODE_REVIEW browser smoke now requires matched interview pages to render the meeting/person boundary copy, proving app-dev keeps the interview scoped to its own evidence while treating same-person interviews as separate context.
- OPEN_SOURCE_BUG_FIX and dev-container assessment invites now deliver controlled workspace room links, while the workspace smoke only permits assessment-only handoff skips for CODE_REVIEW.
- The deployed workspace smoke now reports current assessment-only CODE_REVIEW handoffs as an explicit `assessment_only_handoff` skip unless `WORKSPACE_SMOKE_REQUIRE_ROOM=1` is set, replacing the stale room-URL parsing failure.
- The local repo-matching test skill and product-readiness playbook now document the current `/assess` boundary: ready CODE_REVIEW assignments render the challenge, while blocked standalone handoffs must stop at `PROFILE_RECEIVED` / `candidate-intake-queued` instead of teaching agents to wait inside a matching screen.
- Recruiter CODE_REVIEW detail smoke now rejects the stale “Do not advance from this signal yet” person-profile recommendation and accepts the assignment-fairness review wording instead, keeping deployed browser proof aligned with the current hiring-manager decision model.
- The deployed CODE_REVIEW smoke now hard-fails blocked standalone handoffs that return candidate-visible `WAITING_FOR_MATCH`, preserving the `/assess` boundary by requiring the candidate-safe `PROFILE_RECEIVED` queued state instead.
- Candidate `/assess` now preserves queued standalone CODE_REVIEW handoffs as a first-class “Profile received” state when the server returns `candidate-intake-queued`, keeping candidates out of the old matching dashboard and making it clear they are done until a source-backed review is assigned.
- Person profiles now use the same assignment-fairness recommendation for weak graph-derived CODE_REVIEW scores as selected-interview CODE_REVIEW decisions, so hiring managers see a consistent “review fairness before rejecting” callout instead of a harsher unexplained stop signal.
- Assessment room package metadata, CI labels, brand chip copy, and basic-auth handoff pages now consistently use assessment-workspace wording.
- Room-dev now ships PIPE assessment-room shell metadata, keeping browser titles anchored to the core assessment product.
- Weak CODE_REVIEW scores now propagate to the person profile as assignment-fairness decisions even when the compact submission projection is absent, preventing scored interviews from telling hiring managers to wait for a review that already produced a score.
- Recruiter interview detail now fails soft on optional living-context, related-evidence, linked-meeting, invite-link, progress, and score/match projections, so the core CODE_REVIEW decision surface does not sit on an indefinite spinner when an auxiliary app-dev read stalls.
- CODE_REVIEW invites still deliver assessment-only `/assess` links, while dev-container and open-source bug-fix assessment invites now create controlled workspace room links with video, recording, chat, terminal, and code-server evidence.
- CODE_REVIEW progress and scoring now require a complete challenge packet contract — repo URL, base commit SHA, task, success criteria, and expected evidence — before treating a task as ready or scoreable.
- Source-backed assessment evaluation now normalizes missing or unsupported AI recommendation strings to a safe human-review recommendation, records a diagnostic, and prevents recruiter pages from rendering arbitrary model text as hiring advice.
- Person profile assessment validity copy now explicitly calls selected-interview workspace assessments source-backed signals, preserving the boundary between evidence and hiring decisions.
- Person profile selected-interview assessment readouts now show score provenance from evaluator dimensions, source evidence items, and scoring coverage metrics.
- Assessment progress now exposes commit-to-challenge binding separately from commit capture integrity, and commit submissions are checked against assigned challenge repo/base anchors even when those anchors exist only in exact packet text.
- Assessment readiness now requires the submitted commit to bind to the latest assigned challenge packet before entering ready-for-evaluation, so reassigned tasks cannot inherit stale commits as usable proof.
- Person profile relationship timelines now classify related interactions as decision evidence, calibration context, background evidence, or operational events so related meetings stay useful without blurring the hiring recommendation.
- Dev-container Durable Object alarms now repair the Container scheduler table and fall back to the stored TTL config when Cloudflare's scheduler still reports a missing table, preventing old or partially initialized CODE_REVIEW workspaces from throwing `container_schedules` errors during TTL/finalization alarms.
- Dev-container session creation now stamps lifecycle timestamps explicitly and backfills older null timestamp rows, preventing workspace launch evidence from silently failing after D1 table-copy migrations stripped defaults.
- Assessment progress now exposes a commit integrity signal that distinguishes live workspace-captured commits from manual evidence needing verification, and recruiter/candidate surfaces show the trust label and explanation instead of raw capture-source wording.
- App-dev API proxy responses are now buffered and forwarded with a clean API header set for cookie-authenticated dev sessions, preventing recruiter detail pages from hanging on a spinner when a CODE_REVIEW interview is queued for source-backed PR assignment.
- Repo-task commit submissions now reject GitHub commit URLs that do not belong to the submitted repository or declared fork, preventing unrelated repos from masquerading as assessment work even when the SHA and source refs are shaped correctly.
- Recruiter interview detail API prefetches now fall back to the normal request if the speculative dev-proxy fetch stalls, preventing CODE_REVIEW detail pages from sitting on an indefinite spinner when a matched assessment is already available.
- The deployed CODE_REVIEW assess-link smoke now clicks from the recruiter assessment detail into the person profile and verifies the person-level decision cockpit, keeping the rollup proof attached to the routine app-dev gate.
- The deployed CODE_REVIEW workspace smoke now defaults to the source-backed MUI popover challenge profile, so `npm run smoke:code-review-workspace-dev` proves a real repo/base-commit/finalizer/evaluation path without hidden env overrides.
- The deployed CODE_REVIEW assessment smoke can now require the person-profile decision readout, proving submitted review evidence rolls up beyond the interview detail page.
- CODE_REVIEW source-proof summaries now name the evidence that actually exists for each assessment, dedupe repeated quality-gate wording, and surface missing source bridges before lower-value calibration notes so manual PR assignments do not look like automatic candidate-fit proof.
- Standalone CODE_REVIEW interview details no longer render the generic workspace assessment progress panel when only a repo/PR assignment exists, preventing completed scored reviews from showing stale “Not started” or “No assessment session” copy above the hiring-manager decision readout.
- Person profiles opened from a selected CODE_REVIEW decision now treat that assessment as present technical evidence in the evidence-mix readout instead of incorrectly saying no source mix exists while the full graph stays unloaded.
- Person CODE_REVIEW source-proof summaries now reuse or derive evidence-specific proof wording, so manual PR decisions shown on a person profile do not claim candidate/role provenance that the match did not earn.
- CODE_REVIEW work-packet readouts now show whether submitted commit evidence came from the live workspace finalizer or a manual fallback, keeping hiring-manager trust labels source-backed across the room, interview, and dashboard surfaces.
- Candidate workspace finalization now resolves the assessment by dev-container workspace or linked interview before falling back to an unbound session, preventing a newer unrelated assessment for the same candidate from receiving the submitted commit.

### Added — Assessment readiness

- Workspace finalization now adds bounded `code_server_file_observation` source refs for changed files at the submitted `HEAD`, giving evaluators immutable blob/content evidence for code-server file activity without relying on mocked editor telemetry.
- Candidate dev-container sessions now expose a server-owned workspace finalization endpoint that asks the bridge for source-backed commit evidence, persists it through the repo-task assessment store, and returns candidate-safe progress without internal assessment identifiers.
- Workspace finalization can now return a source-backed commit submission payload without posting it to PIPE, giving smoke tests and bridge clients a safe dry-run path for validating captured commit, diff, command, and test evidence.
- Candidate dev-container panels now expose the source-backed assessment commit drawer, letting candidates submit repository, branch, commit, diff, test or verification-gap evidence through the durable `/rpc/assessment/commit-submission` spine without leaving the workspace.
- Repo-task progress now builds and serializes a canonical readiness snapshot server-side, separating evaluation readiness from usable hiring-signal trust and exposing the same required-proof/confidence checklist to recruiter and candidate surfaces.
- Repo-task assessment progress now includes a durable assignment-trust summary (`matched`, `manual`, `source-backed`, or waiting) so recruiter lists, detail pages, room payloads, and candidate-safe progress can share the same non-overclaiming challenge-fit language.
- Repo-task assessment progress now includes a canonical readiness snapshot with required proof, confidence signals, missing-proof counts, ready-for-evaluation state, and usable-hiring-signal state.
- Candidate room task briefs, submission panels, and status strips now show the same source-backed readiness signal, so candidates can see whether challenge, work, commit, diff, tests/verification, and process evidence are captured before review.
- Recruiter interview cards and detail pages now prefer the readiness snapshot when explaining whether an open-source workspace assessment is ready, blocked, or still missing required proof.
- Assessment setup projections now carry structured recruiter next actions for blocked states, so contact-first invites, candidate-backed unmatched assessments, and matched repos without packets all say exactly what evidence or challenge packet to capture next.
- CODE_REVIEW setup-gap panels now show the same structured next action on the interview detail page, making blocked assignments actionable instead of only explanatory.
- Person-profile next-action CTAs now route conversation-only profiles toward a CODE_REVIEW assessment when the evidence mix says the missing source is a technical assessment, instead of opening another generic context interview.
- Recruiter interview lists now fetch paged, newest-created server results with `limit`, `offset`, and `sort` metadata, loading source-backed assessment progress only for the returned page and exposing an honest load-more count in the dashboard.
- The recruiter dashboard now keeps open-source invite creation on the packet-aware flow by passing explicit repo-task packet fields through the active invite callback and removing the unused quick-create modal that could create partial assessment-looking invites.
- Interview detail pages now render the durable assessment readiness checklist before evaluation, showing each required proof item, missing impact, and confidence signal without exposing raw session, packet, or event ids.
- Candidate Submit Work now shows a dirty-worktree recovery checklist when live workspace finalization refuses uncommitted or untracked changes, giving the exact `git status`, `git add`, and `git commit` commands before retrying finalization.
- Candidate Talent Pool intake now has a public `/talent/:token` route with `/intake/:token` alias, profile paste, GitHub/LinkedIn/portfolio fields, phone screener consent capture, and a dashboard that shows profile received, challenge preparing, ready challenges, and past work without leaking repo-matching internals.
- New `/rpc/talent/resolve-token`, `/rpc/talent/submit-profile`, and `/rpc/talent/upload-profile` routes persist profile evidence, resume uploads, phone screener intent, candidate ingestion state, and internal `challenge_design_queue` items while returning only candidate-safe statuses and ready assessment links.
- Initial candidate invite emails now point to `/talent/:token`; `/assess/:token` remains the entrypoint for real ready assessment assignments.

### Removed — Assessment room simplification

- Removed the obsolete assessment-room vocabulary scanner and package hooks; concrete mode/surface tests now define the supported product surface without carrying discarded product phrasing as fixture data.
- Reworded active agent evidence validators, diagnostics, comments, and tests around the neutral real agent bridge so current assessment surfaces no longer carry off-goal helper language.
- Reworded recruiter code-review transcript pushback labels as implementation-author replies, keeping the hiring-manager readout focused on review behavior rather than internal agent role names.
- Removed the browser-controlled AI helper launch path from the assessment room and invite form; workspace launches now stay focused on repo, terminal, code-server, chat, recording, transcript, commit, and submission evidence.
- Simplified layout tests and render callback naming so the room code stays focused on assessment work instead of unused layout branches.
- Retired client-UI synchronization from the current product plan so the assessment room stays anchored to real repo-task evidence.
- Removed obsolete assessment-panel coordinate and ordering state from the video-room app.
- Collapsed video-room evidence capture to the standard assessment room path, removing the stale replay path.
- Current room evidence is limited to the core assessment sources: video, chat, workspace, terminal, code-server/file events, recording, transcription, commit submissions, and the real agent bridge.
- Removed the legacy room file-system evidence path so CODE_REVIEW proof depends on workspace, terminal, code-server, chat, recording, transcript, commit, and AI-bridge sources instead of stale files.
- Scrubbed current room vocabulary, QA labels, planning docs, contract notes, smoke scripts, and evidence fixtures so product language stays anchored to open-source repo-task assessment.
- Removed obsolete helper chrome and floating panels; real agent bridge status, stdout, and file-change observations now run as headless workspace evidence.
- Removed the remaining fake external-browser label from assessment browser evidence fixtures and historical notes, replacing it with neutral Assessment Browser language.
- Workspace assessment detail pages now keep evaluator claims, cautions, source snippets, coverage chips, and source-ref counts behind a collapsed Evidence audit trail so the hiring-manager decision readout stays primary without losing provenance.
- Assessment setup gaps now render explicit recruiter next actions across interview cards and detail assignment panels, such as sending the candidate evidence invite, rerunning/enriching matching, or attaching a concrete challenge packet.
- The video-room assessment shell now opens terminal and submission inside a focused assessment tools panel.
- Removed abandoned action aliases from the real agent bridge.
- The room now keeps focus on video, chat, workspace, terminal, Submit Work, recording, transcription, and the real agent bridge.

### Added — Human assessment decisions

- Repo-task assessment sessions now support append-only `human_assessment_decision` events with exact source refs, SHA-256 content-hash validation, and provenance checks against session evidence, evaluation reports, evaluation claims, or diagnostics.
- Recruiters can record a source-backed human assessment decision for a scheduled interview after evaluation, and progress snapshots now expose the latest human decision as the terminal assessment readout.
- Person profiles now derive the hiring-manager cockpit from source-backed workspace assessment evaluation and human-decision records, so open-source/dev-container assessments can produce a person-level recommendation without falling back to “collect more signal.”
- Recruiter assessment detail smokes can now click through from an interview to the person profile and verify the person-level decision cockpit, making cross-surface assessment rollups a deployed regression gate.
- CODE_REVIEW interview details now show a compact “why this challenge” explanation near the hiring-manager readout, summarizing the selected repo/PR, match proof, score risk, and remaining question before raw source proof.
- Blocked CODE_REVIEW recruiter readouts now promote the matcher evidence plan into a concrete top-level next action, such as scheduling an evidence call with the exact first question, adding role requirements, or selecting/ingesting a source-backed repo challenge.
- Scored CODE_REVIEW recruiter readouts now include a compact score-trust panel that explains why the score is usable, what still needs calibration, and how to use the score without treating it as an automatic decision.
- Person CODE_REVIEW decision cards now show a compact “why this recommendation” rationale, separating candidate signal, source trust, and calibration needs without opening the raw evidence audit trail.
- Person relationship timelines now include a quiet evidence-mix readout that tells hiring managers whether technical, resume, and conversation sources are sufficient or whether the next useful source is a calibration call or technical assessment.
- Candidate RPC assessment routes now expose source-backed repo-task progress and accept exact commit/diff submissions through the durable assessment evidence spine while hiding internal assessment and event ids.
- Interview cards and detail pages now prefer the explicit human decision over the AI evaluator recommendation while still preserving evaluator status, claims, and cautions.
- Interview detail pages now expose the reviewer decision form after source-backed evaluation, posting the selected advance/hold/reject/needs-more-evidence decision to the real human-decision endpoint and updating the readout immediately.
- Recruiter detail Playwright smoke coverage now supports both CODE_REVIEW and workspace assessment pages, including optional assertions for submitted work packets, evaluator claims, human-decision forms, and recorded human decisions.
- Recruiter detail smoke now scopes fallback-copy assertions to the assessment decision readout, so legitimate “call not recorded yet” scheduling state does not mask a successful open-source assessment report.
- Recruiter detail smoke can now click through to the person profile and verify source-backed workspace assessments roll up into a person-level decision cockpit instead of staying trapped on the meeting page.

### Added — Evidence conflict detection (criteria #2, #6, #8)

- `GET /api/v1/candidates/:id/living-context/evidence-conflicts` — detects contradictory evidence across sources for a candidate. Identifies polarity conflicts (one source affirms, another contradicts) and strength divergence (same polarity but wide strength range). Returns severity classification (high/medium/low), deterministic conflict IDs, per-side assertion lists with effective strengths, and match impact descriptions. Gated by `living_context_read`.
- `GET /api/v1/internal/evidence-conflicts?candidateId=xxx` — internal version for backfill/evaluation use.
- `evidenceConflicts.ts` — core module: `detectEvidenceConflicts()` queries assertions via signal evidence, joins concept registry for canonical keys, groups by concept, detects polarity and strength-divergence conflicts, applies temporal decay, classifies severity, and produces deterministic conflict IDs.
- `evidenceConflicts.test.ts` — 6 Vitest tests: no workspace identity, no conflicts, polarity detection, high-severity classification, deterministic IDs, severity sorting.
- Candidate route coverage now proves the recruiter `evidence-conflicts` endpoint returns persisted source-backed opposing claims for an owned candidate behind the living-context rollout gate.
- `EvidenceConflictsPanel` component in `LivingContextGraph.tsx` — renders conflict cards with severity badges, affirming/contradicting side-by-side views, and match impact descriptions.
- `useEvidenceConflicts` hook (`src/hooks/useEvidenceConflicts.ts`) — fetches conflict report for a candidate.
- Frontend types: `ConflictType`, `ConflictSeverity`, `ConflictAssertion`, `EvidenceConflict`, `EvidenceConflictReport`.

### Added — Evidence readiness and candidate comparison

- Living-context candidate profiles now expose evidence-readiness scoring across resume, interview, assessment, code-review, meeting, phone-call, culture, and learned-concept dimensions, with temporal decay, strongest/weakest dimensions, and recruiter-facing recommendations.
- Recruiter and internal APIs can compare candidate evidence profiles by interaction mix, assertion depth, source diversity, shared concepts, unique concepts, and freshness-ranked coverage.
- Living-context internal health routes now include evidence-readiness, candidate-comparison, and session-event ingestion coverage so assessment-room activity can be reconciled into the durable person graph.
- The living context graph UI now includes an evidence-readiness panel and hook for per-dimension readiness bars, recommendation cards, and API-backed loading/error states.
- The recruiter rematch hook now has focused unit coverage for matched, needs-more-evidence, pending, failure, and missing-candidate states, preserving the useful coverage from the consolidated living-context workstream.

### Fixed — Auth

- Recruiter e2e auth smoke now targets a stable auth-gate sign-in test id and waits long enough for slow Clerk dev-instance boots, so local click testing does not fail while the app is still on the loading splash.

### Fixed — Scheduling

- CODE_REVIEW matching now repairs unprojected resume candidate nodes into living-context records, derives source-text phrase terms, and preserves role-overlap evidence atoms before selecting a PR, so role-backed repo matching can use decomposed evidence instead of falling back to queued intake.
- CODE_REVIEW stage config now keeps blocked or pending repo matching inside an incomplete assessment stage with a `WAITING_FOR_MATCH` challenge instead of marking candidate intake complete.
- Standalone CODE_REVIEW intake now advances directly into an explicitly assigned source-backed PR review instead of incorrectly queuing the candidate behind background matching.
- Source-backed assessment evaluation finalization now tolerates the production sequence where an evaluated report is already persisted while the session still reads as final-submitted, preventing workspace evaluation from returning a false 500 after durable evidence is written.
- Source-backed assessment sessions can now record a recruiter human decision after evaluation, require that decision to cite persisted assessment evidence or report output, and surface the human decision on interview detail/readout cards.
- Interview detail person-profile links now prefer the living-context person id over contact-row ids, preventing assessment-only meetings from opening a 404 instead of the accumulated person evidence page.
- Assessment living-context ingestion/backfill now resolves interview-linked sessions whose `assessment_sessions.candidate_id` is empty through `scheduled_interviews.candidate_id`, and includes a dedicated evaluation catch-up task for partially ingested sessions whose original checkpoint already completed, so older open-source assessment runs can roll evaluator claims into the person profile instead of staying as meeting-only evidence.
- Review challenge packet context refs now validate against the persisted packet id/hash while allowing assessment evidence to carry a human-readable packet excerpt, preventing valid open-source challenge assignments from blocking person-graph ingestion.
- Scheduled living-context backfills now return partial batches to `pending` after persisting their cursor instead of leaving the checkpoint stuck in `running`, allowing large catch-up jobs to continue across trigger invocations.
- Manual open-source challenge packets now verify the assigned base commit is reachable in the selected GitHub repo before creating the interview, preventing fake immutable task packets from entering the assessment flow.
- Scheduled open-source, code-review, and dev-container assessment invites now create linked meeting rooms with explicit workspace, recording, and Agent feature flags plus assessment-specific title/description copy, while standard video invites stay out of the dev-workspace path.
- Assessment progress now carries evaluator diagnostic previews through recruiter and room APIs and shows evaluator cautions on interview details and cards, making missing-test or human-review risks visible beside source-backed claims.
- Recruiter interview lists now include assessment filters and counts for action-needed, ready-to-evaluate, needs-attention, and evaluated sessions so source-backed assessment work is not buried in the general invite feed.
- Recruiter interview cards now expose an `EVALUATE` action for assessment sessions that have captured commit evidence and are ready for source-backed AI/human evaluation, using the same real evaluation endpoint as the detail page and refreshing the list afterward.
- Interview cards now show a compact assessment decision state for assigned tasks, submitted commits, evaluator readiness, evaluated recommendations, and diagnostics so recruiters can understand the next action without opening every interview.
- Interview cards now show the assigned open-source assessment task, repo/PR, and base commit from the source-backed challenge packet before candidate work starts, so recruiters can trust what was assigned without opening the full detail page.
- The deployed workspace assessment smoke now verifies that recruiter detail and list surfaces both show the submitted assessment commit and evaluated source-backed report after the live container finalizer runs.
- Calendly invites now include stable Pipe interview tracking, keep provider links free of dev basic-auth credentials, resolve same-email bookings by tracking id, and record booking-confirmation emails separately from original invite delivery.
- The deployed MVP browser smoke now uses a remote-safe timeout for the People context drawer, so app-dev validation does not fail while the source-backed context panel is still loading.
- The authenticated MVP browser smoke now follows the current Interview plans and People UI, injects Clerk's testing token in the smoke context, and retries the initial app-shell load so local route validation fails on product regressions instead of stale selectors or auth handoff flake.
- Interview lists now default to newest-created ordering and include Newest, Timeline, and Oldest controls so recruiters can scan recent invites without losing the existing scheduled-time view.

### Fixed — Video room

- Room-dev now recovers stale hashed JS/CSS asset requests by serving the current deployed bundle from the active room shell, preventing cached room shells from blanking after rapid deploys.
- Workspace launch now has an explicit host opt-in for starting the real Devin bridge and sends `agentType: "devin"` only when selected, so Agent agent chat remains honest instead of implying a fake assistant.
- Workspace finalization now refuses dirty or untracked working trees before submitting `HEAD`, preventing uncommitted VS Code edits from being hidden behind an older assessment-branch commit.
- Room metadata now returns `videoEnabled`, `workspaceEnabled`, `recordingEnabled`, and `agentEnabled` feature flags matching the frontend contract, preventing Agent or recording controls from silently falling back around stale short-form keys.
- Workspace-assessment rooms now publish an explicit `NOT_LAUNCHED` source-backed workspace state before a container session exists, removing rejected prejoin workspace telemetry noise.
- Dev-container assessment rooms now ignore stale initial assessment-mode snapshots from the Durable Object, keeping rooms code-first on join while still honoring explicit assessment-room selection.
- Code-first dev-container rooms now keep a candidate-safe open-source task brief beside VS Code, showing repo, base commit, task, success criteria, expected evidence, current step, and Submit Work without exposing source hashes or internal provenance.
- Meeting-room basic-auth route regressions now use the real room-dev host when asserting credential injection, keeping the tests aligned with the dev-host-only auth hardening.
- Failed, stopped, and expired dev-container workspaces now present an explicit Relaunch workspace recovery action in the room status strip, prejoin panel, and workspace panel instead of leaving hosts with a generic launch prompt.
- Workspace terminal sessions now decode browser `TERMINAL_INPUT` control frames and normalize xterm carriage returns before writing to bash, so candidate terminal commands execute as commands instead of JSON blobs.
- Workspace-enabled rooms now start in the standard code-first assessment surface and ignore obsolete client-UI state events.
- Workspace stops now append source-backed dev-container stop evidence to linked assessment sessions and return refreshed progress, keeping container lifecycle actions in the same durable interview spine as launch and commit evidence.
- Workspace launches now append source-backed dev-container launch evidence to linked assessment sessions and return refreshed progress immediately, so opening VS Code is part of the durable assessment spine instead of only browser telemetry.
- Video rooms now refresh the visible assessment progress after source-backed room events are accepted, so chat, terminal, and Agent/agent evidence can move the status strip without waiting for a reload or commit submission.
- Room chat, terminal, Agent/agent, and replayed room activity now append source-backed evidence to the scheduled-interview assessment session when one exists, so assessment progress reflects real room work instead of a sidecar Assessment session.
- Submit Work now shows the assigned open-source challenge contract and reloaded assessment evidence status before submission, so candidates can see the repo, base commit, task, success criteria, expected evidence, and captured/missing evidence without guessing what “done” means.
- Video rooms now reload durable assessment progress from the meeting-room API on entry/rejoin, so accepted commit submissions, next actions, and evidence coverage survive refreshes instead of existing only in local Submit Work state.
- Code-first assessment rooms now keep the source-backed assessment status visible outside the video picture-in-picture and update it with the accepted commit submission progress snapshot, including stage, commit SHA, next action, and captured evidence coverage.
- Dev-container assessment rooms now open into a code-first assessment layout by default, with the VS Code workspace as the primary surface, video/chat supporting the session, and Submit Work present as the completion path.
- Assessment Submit Work now validates GitHub repo/fork/commit/PR URLs, full commit SHAs, assessment branch names, and diff-to-file alignment before sending source-backed commit evidence, and shows the exact Git commands candidates should paste.
- Video rooms now show a compact assessment status strip with mode, repo/PR/base commit, workspace state, challenge task, and next action so standard calls, code reviews, and dev-container assessments are legible inside the call.
- Video call controls no longer include a separate assistant button; real Agent/Devin bridge evidence is captured from the workspace bridge without opening a floating room panel.
- The assistant bridge now uses plain assessment UI instead of character branding.
- Closing the Agent bridge now closes only the assistant panel, so the room no longer leaves orphaned assistant UI over chat.
- Assessment commit submission now makes upstream PR tracking an explicit opt-in, blocks upstream PR URLs without candidate approval, and stores approved PR links as exact source-backed evidence instead of treating them as implicit metadata.
- Standard-room assistant controls now restore the visible prompt without opening or closing the dev-container agent bridge.
- Assessment assistant control clicks now publish source-backed evidence instead of leaking the DOM click event into the Agent action origin.
- Closing an Agent notice now dismisses only that notice instead of hiding the assistant.
- Agent now renders through a single controlled prompt and bridge chat surface, preserving the no-duplicate-assistant fix without leaving an orphaned notice behind.
- Agent bridge chat now keeps assistant status inside one controlled panel, preventing overlapping assessment dialogs from blocking chat controls.
- Video-room no-device joins now keep retry controls styled and disable unavailable mic/camera buttons instead of publishing source-less media-control actions.
- Video rooms now let participants enter when camera or microphone access is unavailable, while keeping a retry-devices action for restoring media after joining.
- Code-server file and terminal room evidence now uses deterministic source-backed event ids end to end, preventing replayed workspace evidence from being accepted under unrelated transport ids.
- Video-room recording state events now require the event id to match the source-backed recording state id before optimistic updates, broadcasts, or Durable Object persistence, preventing stale recording/transcript state evidence from replaying under a different event identity.
- Video-room media control events now require the event id to match the source-backed media control id before optimistic updates, broadcasts, or Durable Object persistence, preventing stale mic/camera evidence from toggling the wrong shared state.
- Room chat messages now carry and verify an exact text fingerprint in source-backed evidence, preventing same-length stale or tampered chat payloads from replaying as valid meeting evidence.
- Historical assessment surface toggles required deterministic integer capture times and known room phases before replaying, preventing malformed surface evidence from moving participants between call views.
- Historical assessment panel events now reconstruct ids and verify metadata before replaying, preventing stale evidence from changing the wrong assessment panel.
- Agent now renders only through the controlled assistant panel.
- The assessment assistant no longer opens the agent bridge diagnostics panel in standard rooms that were not configured with a dev workspace.
- Room-dev now clears stale origin cache only during the basic-auth handoff, while missing old hashed `/assets/*` bundles return 404 instead of the SPA shell so rapid deploys do not leave Safari on a blank stale room bundle.
- Added a deployed Agent/Devin chat smoke that launches a real dev-container room, waits for `AGENT_READY`, sends a real Devin API prompt, and fails unless the agent response and bridge diagnostics are source-backed and persisted.
- Standard video rooms no longer publish no-op workspace layout events, removing rejected source-backed evidence console noise while preserving real dev-container workspace diagnostics.
- Historical peer-presence evidence rendered through isolated transform layers, reducing stale artifacts while preserving provenance for archived sessions.

### Fixed — Candidate repo matching

- Pipeline CODE_REVIEW CV intake now finishes with the candidate-safe profile-received state while background ingestion/matching continues, keeping unfinished repo matching out of `/assess/`.
- Candidate CODE_REVIEW assessment links now open directly into the assigned PR review after start instead of depending on a synthetic welcome submission, preventing ready assessment links from trapping candidates on the intro card.
- Candidate CV intake now records a queued ingestion state and ends the code-review candidate flow with a profile-received message instead of advancing into the internal repo-matching/decomposition waiting room; matching and retry work continues in the background.
- Assessment evaluator prompts, reports, and scheduling progress fixtures now cite `code_diff` evidence using the exact submitted `baseCommitSha..commitSha` range, keeping evaluator provenance aligned with commit-submission validation.
- Commit submissions now require `code_diff` source refs to identify the submitted `baseCommitSha..commitSha` range, preventing unrelated diffs from backing assessment commits.
- Commit submissions now must match the assigned source-backed challenge packet's repository URL and base commit when those locator fields are present, preventing candidates from submitting unrelated repo or wrong-base work into the assessment spine.
- Dev-container assessment rooms now poll the real assessment progress endpoint while active, keeping the candidate task brief, status strip, and submit-work path current when backend, host, guest, or container evidence changes after initial room load.
- Repo-task assessment events, final bundles, and commit submissions now trigger best-effort real-time living-context ingestion, so candidate plans, room evidence, and submitted commits become person-graph evidence before the evaluator report exists.
- Interview details now show a deterministic candidate work packet for submitted assessment commits, including branch, changed files, test evidence, AI-use evidence, and the human-review next action.
- Interview cards and detail pages now label assessment task assignment provenance as PIPE-matched, manual, waiting, or blocked, so recruiters can see whether a repo challenge came from source-backed matching or a recruiter override.
- Recruiter assessment progress now includes a compact source-backed evidence trail with exact challenge, commit, diff, test, terminal, and AI snippets so humans can review the artifact trail behind an open-source assessment report.
- Repo-task assessment evaluation now salvages complete source-cited claims from truncated Workers AI JSON responses and records an explicit evaluator-output warning instead of downgrading usable evidence to `AI_DEVELOPER_UNAVAILABLE`.
- Assessment evaluator diagnostics now surface as recruiter-visible cautions on interview detail and interview cards, including severity, code, message, and source-ref counts/types.
- Repo-task assessment reports now prefix evaluator summaries with the assigned challenge task from exact source-backed challenge-packet evidence, so live open-source bug-fix evaluations remain task-specific even when model prose is generic.
- Repo-task assessment evaluation now extracts source-cited claims from structured plain-text Workers AI responses when the model ignores the JSON-only instruction, while still dropping source-less positive claims.
- Meeting transcript living-context ingestion now skips only concept-adjacency persistence when partial schemas lack the adjacency table, preserving source-backed transcript and assessment evidence during staged rollout.
- Repo-task assessment evaluation now repairs bare-key JSON object responses from Workers AI before validating source-backed claims, preventing matched open-source assessments from becoming diagnostics when the model returns JavaScript-style object syntax.
- Interview detail assessment progress now renders the source-backed open-source challenge contract, including repo, base commit, task, success criteria, and expected evidence, so recruiters can review the actual assignment instead of a one-line challenge summary.
- Assessment progress readouts now distinguish chat, workspace telemetry, and tool activity evidence instead of collapsing every captured interaction into a vague work-evidence bucket.
- Recruiter assessment reports now separate required proof from confidence signals, making the challenge/commit/diff proof chain visible apart from optional tests, terminal, editor, and AI-use coverage.
- Source-backed assessment progress now exposes evaluator claim previews, and recruiter reports render those claims with polarity, dimension, confidence, and source-ref counts/types.
- Open-source workspace interviews now lead with a hiring-manager assessment decision readout for decision, challenge fit, required proof, risk, and next action before exposing raw progress evidence.
- Roleless CODE_REVIEW matching now has regression coverage for a live-shaped `mui/base-ui` PR packet and recruiter-visible evidence traces, verdict summaries, annotations, and AI developer pushback threads.
- Commit submissions are now rejected unless the submitted HEAD is on `pipe-assessment` or a `pipe-assessment/*` branch, with the same rule enforced by the browser payload builder, durable assessment session store, and dev-container finalizer.
- Workspace bridge revision `2026-06-30-assessment-branch-v1` forces dev containers onto the assessment-branch-enforcing finalizer during deployed smoke validation.
- Deployed workspace smoke can now prove the task-aligned MUI popover challenge through the matched-repo path, asserting the selected review challenge packet's repo id, PR number, base/head commits, and source-backed packet text instead of relying only on manual task assignment.
- Deployed workspace smoke now defaults to the concrete `mui/base-ui#973` open-source bug-fix profile and blocks placeholder commits unless explicitly enabled for local plumbing, so the main dev proof exercises a real task packet, assessment branch commit, evaluator report, and recruiter readout.
- Candidate assessment rooms now show a proof checklist in the task brief, marking challenge packet, workspace telemetry, work evidence, assessment branch commit, tests/verification notes, AI use, and interview context as captured or missing before submission.
- Deployed workspace smoke now loads `.env.local` and `.env` before reading dev Basic Auth credentials, matching the code-review smoke runner and keeping app-dev workspace validation runnable without exporting duplicate shell variables.
- Repo-task assessment evaluation now tolerates fenced JSON with trailing commas and shortened source-ref ids from Workers AI, preventing valid source-backed submissions from becoming blocking evaluator diagnostics.
- Repo-task assessment evaluation regression coverage now verifies shortened AI source-ref ids still persist claims against the exact stored source refs.
- Repo-task assessment evidence coverage now counts source-backed `code_server_file_observation` refs as code editor/file activity, so recruiter reports no longer claim file evidence is missing when code-server observations were captured.
- Deployed workspace smoke now has a task-aligned MUI Base UI popover profile with a real repo URL, immutable base commit, PR-derived patch, popover-specific challenge packet, and evaluator checks for useful task-specific assessment.
- Workspace finalization now adds a source-backed `terminal_command` ref for the exact git/test commands the bridge runs, so evaluation coverage can distinguish real finalizer terminal evidence from missing interactive terminal history.
- Workspace bridge revision `2026-06-30-finalizer-terminal-v1` forces app-dev containers onto the finalizer terminal-evidence bridge during deployed smoke validation.
- Workspace bridge revision `2026-06-30-finalizer-terminal-v2` forces a fresh Cloudflare container image digest after Wrangler preserved the previous dev container application image for the first finalizer rollout.
- Assessment progress now exposes and renders the evaluator recommendation beside the summary, and deployed workspace smoke can run a task-aligned `mui/base-ui` popover fix instead of only a placeholder commit.
- Matched open-source challenge packets now remain the room/workspace assignment source even when they include an upstream PR number, so workspaces launch from the packet's immutable base commit instead of the PR head; the deployed workspace smoke can now verify this matched-repo path.
- Scheduling list and detail payloads now include the latest linked workspace session status, repository URL, base commit, expiry, and error message so hiring-manager surfaces can distinguish ready, expired, and failed code-review workspaces.
- Person profiles now keep source signals, learned context, and original source artifacts inside a collapsed evidence audit trail by default, leaving the decision cockpit and relationship timeline as the first-read hiring-manager surface.
- `OPEN_SOURCE_BUG_FIX` scheduling now promotes a matched repo into an assigned assessment only when a production-ready review challenge packet has exact source provenance, creating the source-backed assessment session from that packet and failing closed otherwise.
- Scheduled interview detail now redacts accumulated person-level evidence arrays from its `livingContext` payload, keeping meeting pages scoped to summary counts and related-interview previews while the full graph stays on the person profile.
- CODE_REVIEW recruiter detail smoke now verifies the deployed hiring-manager readout directly, so app-dev validation protects the compact decision, assignment, score validity, risk, and next-action summary.
- CODE_REVIEW recruiter detail now starts with a compact hiring-manager readout for decision, assignment trust, score validity, risk, and next action before exposing deeper evidence panels.
- Repo-task assessment evaluation now sends a compact source-ref prompt with explicit claim/diagnostic limits, and the deployed workspace smoke must produce a reviewable source-backed evaluation report after finalizing a real commit.
- Code-server container images now expose an explicit bridge revision in health checks, forcing dev-container deploys to roll forward when the terminal bridge changes and making stale image rollouts visible in smoke tests.
- Workspace bridge revision `2026-06-30-terminal-crlf-v3` forces app-dev containers off stale pre-revision images during deployed smoke validation.
- Code-server containers now restart the workspace bridge or code-server child process if either exits, avoiding a dead workspace when one side of the dev-container router crashes.
- Deployed workspace smoke now creates a real commit through the live container terminal and finalizes it into source-backed assessment evidence, proving the open-source task path reaches a submitted commit.
- Standalone `DEV_CONTAINER_CHALLENGE` and `OPEN_SOURCE_BUG_FIX` invites now use the source-backed D1 review-challenge matcher once candidate evidence is ready, caching the matched repo/PR on the scheduled interview instead of leaving candidates stuck without a repository assignment.
- Contact-first scheduled interview context records now retain recruiter notes in graph qualifiers as well as exact source text.
- Manual open-source challenge packets can now be repo-only with an exact base commit and task contract; the room treats source-backed repo task packets as assigned even without a PR number.
- The deployed workspace smoke can now run `OPEN_SOURCE_BUG_FIX` mode without a PR and verify the room exposes the assigned source-backed task packet.
- The workspace smoke now uses room credentials from generated room links and requires a real base commit SHA for deployed open-source task verification.
- Deployed workspace smoke now preflights that the requested base commit is reachable from the selected repository before creating any invite or launching a container.
- Deployed workspace smoke now verifies the bridge finalizer endpoint through the room proxy and fails unless unchanged work is honestly blocked instead of submitted.
- Dev container workspaces now mark `/workspace` as a safe Git directory, start with explicit internet access, and use production cold-start timeouts so exact-base-commit repo tasks do not crash before VS Code can boot.
- Submit Work now has a primary Finalize from workspace action that sends the live container's current assessment-branch HEAD, diff, changed files, and optional test command through the real bridge finalizer instead of requiring candidates to paste git evidence manually.
- Room workspace launches no longer inject Devin by default; code-review rooms start a plain reliable code-server workspace unless the launch explicitly requests a configured agent.
- Code-server containers now start the workspace bridge even when no AI agent is configured, keeping VS Code proxying, terminal access, bridge health, and commit finalization available without fake Agent replies.
- Dev-container launches now explicitly use the baked code-server entrypoint so deployed Cloudflare Containers expose the workspace bridge/router instead of bypassing it and serving code-server directly.
- Workspace-backed repo tasks now expose a bridge finalizer that turns the candidate's real HEAD commit, diff, and optional test command output into source-backed commit-submission evidence for the linked assessment session.
- `DEV_CONTAINER_CHALLENGE` assessment sessions now share the commit-required progress path with open-source bug-fix repo tasks, so reproduced work evidence leads to submit-commit instead of a generic capture-evidence state.
- CODE_REVIEW recruiter decision and assignment panels now label assignment trust explicitly, distinguishing automatic matches from manual repo or PR tasks before managers treat the review as candidate-fit evidence.
- CODE_REVIEW and dev-container recruiter projections now label matched repo+PR assignments as source-backed automatic matches instead of manual PR overrides, preserving assignment provenance after repo matching caches the selected challenge.
- WAITING_FOR_MATCH browser coverage now waits for the visible candidate gate state instead of `networkidle`, preventing the auto-refresh smoke from timing out on intentional polling activity.
- Candidate assessment BDD now guards the one-use invite lifecycle: resolving a link does not mark it used, while explicitly starting the assessment claims it and makes subsequent raw-link resolves fail.
- Playwright recruiter auth setup now waits for the Clerk session cookie instead of old shell copy or `networkidle`, making authenticated smoke gates less brittle.
- MVP browser smoke now opens the merged person profile after roleless evidence ingestion, uses the app-dev recruiter API proxy for deployed setup, and verifies the decision cockpit, evidence coverage, and quiet source-id handling in a real browser.
- Room commit submissions now recompute source-ref SHA-256 hashes server-side before persisting assessment evidence, rejecting mismatched exact-text hashes.
- CODE_REVIEW recruiter detail smoke now verifies score validity and can assert the assessment invite recipient, so app-dev checks cover the hiring-manager cockpit instead of only page load.
- Manual open-source challenge invites now require a 40-character hex base commit SHA in the modal, matching server validation before a repo task packet can be created.
- CODE_REVIEW assessment invite panels now show the invite recipient next to link validity and assessment state, making one-use links easier to distinguish across multiple meetings for the same person or email.
- Interview dashboard cards now prefer the per-invite recipient name and email over older canonical person labels, so multiple meetings for the same address remain distinguishable.
- Person profile relationship timelines now lead with a quiet evidence-coverage summary, showing whether the person graph is built from code reviews, calls, resumes, messages, or other evidence before recruiters scan individual interactions.
- CODE_REVIEW recruiter decision panels now show score validity before the score details, making clear whether the score is usable, pending, incomplete, or unsafe to rely on when repo fit is not proven.
- CODE_REVIEW related-meeting panels now lead with a quiet decision summary, source-backed next action, and signal counts before showing preview rows, so cross-meeting context supports the current decision instead of reading like noisy extra evidence.
- Starting a candidate assessment now marks only the delivered or selected linked code-review/dev-container/open-source interview active, so recruiter headers no longer remain stuck at invited without activating unrelated meetings for the same person.
- Fresh direct code-review and dev-container assessment links now stop at the candidate start gate and only claim the one-use invite after the candidate clicks start.
- Candidate matching status cards now report failed manual refreshes instead of showing a false "checked" state when the status API fails.
- Recruiter assessment invite panels now describe claimed one-use links as started rather than opened, keeping link validity aligned with the candidate start boundary.
- Already-started candidate assessment links no longer show a retry button that cannot recover the one-use invite state.
- Candidate-facing used assessment links now say the assessment already started instead of implying that merely opening the link consumed it.
- Candidate assessment links now only show as used after the candidate has actually started the assessment; pre-start claimed-prefix rows are repaired and recruiter link state now says started instead of opened.
- Person code-review decision basis now labels match provenance as a source-backed match instead of exposing raw source-count totals, keeping the hiring-manager view quieter and less misleading.
- Living-context code-review match panels now keep raw source proof, hyperedge alignment, repository overlays, and matcher diagnostics collapsed behind an audit drawer by default, preserving traceability without overwhelming the hiring-manager read.
- Candidate assessment links now claim their one-use token only when the candidate starts the assessment or submits a response, so merely opening the invite page no longer burns the link.
- Candidate waiting screens now hide unavailable profile actions, show manual status-check feedback, and avoid silent no-op buttons while evidence decomposition or repo matching is pending.
- CODE_REVIEW interview detail now labels repo-only rows as assignment setup gaps until a concrete PR/source-backed match exists, preventing draft repositories from reading as validated review assignments.
- CODE_REVIEW person-context previews now say “other interviews for this person,” making cross-meeting context clearly separate from the current interview record.
- Person next-action interview CTAs now carry the recommendation, uncertainty, and missing-context objective into scheduled interview notes and source-backed invite evidence, preserving why the follow-up exists.
- CODE_REVIEW assessment invite panels now show the assessment evidence state separately from link validity, making claimed-without-submission invites visibly distinct from completed assessment evidence.
- Person code-review decision cards now show a quiet decision-basis row for score report, review transcript, repo challenge, and match proof so hiring managers can see why the recommendation is usable without opening raw evidence.
- CODE_REVIEW person-context panels now label related meetings as capped context previews, show the preview count, and link to the full person graph so interview pages do not read like they own every interaction.
- Assessment commit submission now requires either real test output or a source-backed missing-test note, so repo-task assessments record verification gaps honestly instead of silently omitting test evidence.
- CODE_REVIEW interview details now explain claimed assessment links as opened-with-or-without-submission states and show compact score signal-basis chips for scored reports, annotations, pushback, and match proof before recruiters rely on the decision.
- Person profile decision cockpits now surface missing context as a top-level card, so hiring managers can see blocking evidence gaps or calibration probes without opening raw proof.
- CODE_REVIEW assessment invite panels now surface link status, shareability, and the next safe action as a compact validity summary, making claimed or stale candidate links obvious before recruiters try to share them.
- Related evidence rows on CODE_REVIEW interview details now describe same-person items by interview kind, such as related code reviews or conversations, instead of the generic “same person assessment” label.
- CODE_REVIEW assessment invite panels now distinguish active, claimed, and stale candidate links, hide copy actions for used links, and offer a resend action directly from the interview detail so recruiters can recover without sharing a burned token.
- Assessment progress snapshots now preserve evaluator evidence-coverage gates and show quiet captured/missing chips for tests, terminal, editor, and AI-use evidence, making repo-task scores easier to trust without exposing raw source refs.
- CODE_REVIEW interview match panels now collapse assessment-quality rubric details behind a quiet quality gate, keeping the recruiter decision readable while preserving source-backed checks.
- Repo-task AI evaluation prompts now include a deterministic source-ref coverage contract, making missing test, terminal, editor, or AI-assistance evidence explicit and preserving that coverage in the evaluation report.
- CODE_REVIEW match proof drawers now use human evidence fallbacks instead of exposing source-span, atom, demand, or gap ids when exact source text is unavailable.
- Interview related-evidence and follow-up cards now use human labels instead of falling back to raw interview ids in the hiring-manager cockpit.
- Person profile next-action CTAs now open the new-interview flow with the current person prefilled, turning missing-context and calibration recommendations into an actionable follow-up path.
- Person profile timelines now expose quiet `Open interaction` actions for evidence tied to scheduled interviews, making related meetings actionable without showing raw interview ids.
- Recruiter interview details now recover the candidate assessment URL from an existing unclaimed invite token when the delivery artifact is missing, and label assessment links as one-use candidate invites so recruiters do not accidentally consume them.
- CODE_REVIEW interview decision cards now show compact uncertainty and missing-context summaries at the top of the single-meeting recruiter view, keeping gaps visible without opening the raw proof drawer.
- Interview assessment-progress cards now tolerate older progress snapshots without source-ref counts instead of crashing the recruiter detail page.
- Commit submissions can now attach exact test-run output as source-backed evidence, and room/recruiter progress snapshots show whether test evidence was captured.
- Person CODE_REVIEW decision cards now require source-backed repo-match provenance before labeling a scored assessment usable, and include the match decision sources in the quiet proof trail.
- Assessment Submit Work now renders the backend assessment progress snapshot after commit submission, including stage, state, commit, evidence counts, AI/transcript flags, latest event, and evaluator status.
- Assessment challenge packets now render task, success criteria, and expected evidence from exact source-backed packet text while staying quiet when those sections are absent.
- Uploaded CVs now always create a visible candidate-ingestion state before parsing, failed parsing is recorded instead of swallowed, and candidate assessment routes can restart matching when a resume exists but no ingestion row was ever recorded; recruiter interview details also expose the last delivered assessment link for CODE_REVIEW/dev-container invites.
- People list pages now use the same recruiter surface shell, header, segmented controls, search panel, and card frame as person profiles and interview details, so moving between people index and profile no longer feels like a different app.
- Assessment Submit Work now pre-fills repository URL, exact base commit, and the local assessment branch from the source-backed challenge packet while keeping commit SHA, changed files, diff, and test evidence candidate-supplied.
- Dev-container assessment launches now preserve the challenge packet's exact base commit in the session row, DO init payload, container env, and lifecycle evidence, and the code-server image checks out that commit onto an assessment branch before candidate work begins.
- Person profile and interview detail pages now share the same recruiter surface tokens for page shells, headers, cards, labels, buttons, links, and evidence chips, reducing visual drift across the hiring-manager cockpit.
- Contact/profile route coverage now locks the same-email contact-to-roleless-candidate relationship, proving the person graph stays attached after candidate evidence is added.
- Dev-container assessment rooms now carry the latest source-backed open-source challenge packet into the room workspace payload and render it in the Assessment workspace with repo, PR, base commit, exact task text, and content hash while hiding internal assessment ids.
- The Assessment challenge packet panel now accepts alternate persisted repo, PR, and base-commit locator keys so source-backed packets from different writers still show the concrete task metadata.
- Recruiter interview creation now exposes complete manual open-source challenge packet fields for OPEN_SOURCE_BUG_FIX invites, requiring the repo, PR, base commit, task, success criteria, and expected evidence before submitting a manual assessment packet.
- OPEN_SOURCE_BUG_FIX interview creation now accepts complete manual challenge packet fields, validates manual overrides as real GitHub repository URLs, creates a linked source-backed assessment session, persists the exact open-source task packet as immutable evidence, and returns immediate assessment progress for the recruiter.
- Person profiles now lead with an interview-detail-style decision cockpit and labeled profile record panel, so recommendation, uncertainty, next action, and source proof use the same hiring-manager hierarchy across surfaces.
- Person profile timelines, source cards, and CODE_REVIEW proof drawers now use human evidence labels instead of raw session, resume, or candidate-node provenance ids by default.
- Recruiter interview details now translate repo-task evaluator diagnostics and completed reports into truthful cockpit notices, including evaluator-unavailable and report-ready states.
- Recruiter interview details now include a source-backed Start Evaluation action for ready repo-task commits that runs a real Workers AI evaluator when configured, accepts only claims cited to persisted challenge/commit/diff evidence, and records an explicit diagnostic instead of inventing a score when AI or provenance is missing.
- CODE_REVIEW interview scheduling panels now show a human meeting-room linked state instead of raw internal Pipe meeting ids.
- Person profiles now use the same Clerk-bound API client as interview detail pages and show a visible profile-route error instead of staying on an infinite loading state when person context cannot be addressed.
- CODE_REVIEW interview related-evidence rows now describe follow-up meetings and same-person assessments as human evidence moments without exposing raw linked-meeting ids in the hiring-manager cockpit.
- Dev-container assessment rooms now expose a room-token commit submission endpoint that records real candidate commits through the source-backed assessment session spine while hiding internal assessment ids from candidate responses.
- Assessment dev-container assessment rooms now include a Submit Work panel that posts exact commit and diff evidence to the room-token assessment endpoint, making real commit submission available from the candidate room UI.
- Person CODE_REVIEW decision cards now call out uncertainty and missing context as first-class hiring-manager fields, so the profile explains what remains unproven before the next action.
- Person profiles now use the same compact cockpit shell, header hierarchy, metric strip, and evidence panels as interview details, making person-level context feel like the same hiring-manager surface.
- Interview list cards now include a compact assessment snapshot for CODE_REVIEW and repo-task interviews, showing stage, next action, and evidence readiness without exposing raw assessment ids.
- Interview list assessment-progress loading now chunks D1 lookups and skips only malformed progress snapshots, so recruiters with more than 100 interviews or one corrupted CODE_REVIEW row do not lose the whole interview list.
- CODE_REVIEW interview details now show the assessment-session progress snapshot as a quiet hiring-manager card with stage, next action, evidence readiness, commit, readable challenge summary, and evaluation status while hiding raw assessment ids by default.
- Repo-task commit submission validation now handles nullable source-ref text and GitHub repository path parsing explicitly, keeping the progress snapshot endpoint compatible with strict API typechecking.
- Person CODE_REVIEW decision cards now join separate score, transcript, and candidate-PR match-decision records, so live person profiles can recognize a valid source-backed repo challenge instead of downgrading it to partial signal.
- Person CODE_REVIEW decision cards now recover repo and PR proof from source locators when convenience challenge projections are absent, keeping assessment-validity labels grounded in provenance.
- Repo-task assessment sessions now accept first-class source-backed commit submissions with validated GitHub repo/fork URLs, branch names, commit SHAs, changed files, and exact `git_commit` plus `code_diff` evidence before marking a session final.
- Repo-task assessment sessions now expose a source-backed progress endpoint that shows challenge, work evidence, commit, evaluation status, and the next recruiter/candidate action.
- Person CODE_REVIEW decision cards now name assessment validity and the next action while keeping the source graph closed by default, making person profiles read as hiring-manager decision cockpits instead of raw evidence dumps.
- Person profiles now lead source-backed CODE_REVIEW evidence with a hiring-manager decision snapshot, candidate score, selected repo/PR, probe areas, and expandable source proof.
- CODE_REVIEW interview details now keep accumulated person context as a compact rollup and person-profile CTA instead of rendering the whole cross-meeting evidence timeline inside one meeting.
- CODE_REVIEW app-dev smoke now opens the authenticated recruiter detail page for matched and blocked outcomes, proving the hiring-manager decision surface renders without errors, fallback loaders, or missing next actions.
- Blocked CODE_REVIEW evidence-plan cards now label the lower plan details as evidence to collect instead of repeating the top-level recommended-next-step heading.
- CODE_REVIEW recruiter details no longer show raw matcher confidence beside the hiring decision; the default readout now favors match status, assessment fit, score, pushback, and source-backed proof.
- CODE_REVIEW recruiter details now hide empty call-record panels unless transcript, recording, error, or live-call evidence exists, keeping code-review decisions focused on assessment signal instead of operational placeholders.
- CODE_REVIEW recruiter details now derive a recommended next step from match status, review submission, score, and band, so hiring managers see whether to advance, probe, wait, or collect more evidence before reading the audit trail.
- CODE_REVIEW recruiter details now surface the durable review score, band, narrative, strengths, and probe areas from the scored review session so hiring managers see candidate performance above the evidence audit trail.
- CODE_REVIEW recruiter details now keep the matched PR readout available when optional assessment-session tables are missing from a deployment, instead of crashing the whole interview detail page while loading related evidence.
- CODE_REVIEW failed-refresh cards now show the next evidence question plan and expected answer shape before creating another follow-up assessment.
- CODE_REVIEW recruiter evidence refresh cards now replace stale rerun actions with a next follow-up assessment CTA after consumed evidence still leaves matching blocked.
- CODE_REVIEW repo-match refresh now repairs missing matcher-visible context from exact candidate-owned follow-up source spans before rerunning, so captured evidence no longer leaves recruiters stuck in a projection-pending state.
- CODE_REVIEW repo-match refresh now requires completed follow-up evidence to have a matcher-visible living-context projection before rerunning, and the recruiter UI shows projection-pending evidence instead of offering a stale rerun.
- CODE_REVIEW evidence-plan follow-up transcript answers now materialize as source-backed living-context records with dynamic open-term concepts, so repo-match refreshes consume the new candidate evidence instead of only seeing an assessment-layer ready flag.
- CODE_REVIEW interview detail now shows related evidence interviews from the same person graph, so follow-up calls and multiple assessment invites for one email remain visible as separate source-backed evidence moments.
- CODE_REVIEW evidence-plan follow-ups now require concrete candidate-owned PR, bug, review, trade-off, or verification evidence before unlocking repo-match reruns, while preserving generic answers as blocked source evidence.
- Standalone assessment invites for the same email now immediately attach each distinct candidate/application token to the shared person graph, preserving many assessments and meetings without splitting repo-match evidence.
- CODE_REVIEW evidence refresh reruns now append an immutable source-backed consumption report linking the ready follow-up evidence report and exact transcript spans to the match run that consumed them.
- Pending CODE_REVIEW evidence-plan follow-up cards now show the linked follow-up interview and same-person-graph relationship, making one candidate's many evidence interviews legible from the original match gap.
- CODE_REVIEW interview detail now labels living context as one person graph across multiple evidence moments, making repeated invites, follow-ups, transcripts, and assessments legible as accumulated repo-match evidence.
- Blocked CODE_REVIEW evidence-plan follow-ups now surface the exact attribution failure reason from assessment state transitions on the original interview detail page.
- CODE_REVIEW repo matching now has a regression proving completed evidence-plan transcript evidence can move a candidate from `NEEDS_MORE_EVIDENCE` to a source-backed real PR match with the follow-up answer cited in the match run.
- CODE_REVIEW evidence refresh now refuses to rerun matching with the same already-tried evidence report, preventing stale follow-up evidence from creating repeated matcher attempts without new source-backed context.
- CODE_REVIEW recruiter evidence refresh cards now distinguish "new evidence ready" from "evidence tried, still insufficient," listing remaining match gaps and changing the rerun CTA to require new evidence after a failed refresh.
- CODE_REVIEW evidence-plan transcript capture now treats only candidate/guest answer spans as refresh-ready evidence, while the route regression proves the completed follow-up answer grows the same candidate/person graph used for repo matching.
- Pending CODE_REVIEW evidence-plan follow-ups are now reused and surfaced on the original interview instead of creating duplicate context-call meetings for the same unresolved match gap.
- CODE_REVIEW interview detail now shows a compact person evidence timeline from living-context interactions, making repeated invites, follow-ups, and evidence captures visible as one accumulating person graph.
- Matched CODE_REVIEW evidence refresh cards now mark captured follow-up spans as already used for the current PR assignment and hide the stale rerun CTA.
- Successful CODE_REVIEW evidence refresh notices now name the selected GitHub repo and PR, making the rerun outcome recruiter-legible instead of a generic success toast.
- Completed CODE_REVIEW evidence-plan refresh cards now include concrete source-backed follow-up answer snippets, so recruiters can see the captured evidence behind a rerun instead of only a span count.
- Contact-first scheduling now has regression coverage proving repeated interviews for the same email reuse one contact/person identity while preserving distinct scheduled interview, meeting, participant, and source-backed context records.
- Direct meeting creation now normalizes recipient emails and reuses the same contact for repeated meetings, preserving many-interaction-to-one-person relationships instead of splitting graph context by email casing.
- Calendly webhook email fallback now refuses to mutate an arbitrary pending interview when the same person/email has multiple open invites; ambiguous provider events are imported as their own scheduled meeting while preserving the shared contact/person identity.
- Standalone CODE_REVIEW/dev-container assessment invites now create a separate candidate/application token per interview, so multiple active assessment links for the same email do not collapse onto the latest pending assessment.
- CODE_REVIEW evidence-plan context calls now have integrated regression coverage from follow-up creation through transcript evidence ingestion to original-interview repo-match refresh readiness.
- CODE_REVIEW recruiter evidence-plan cards now frame missing candidate context as a targeted follow-up assessment with the exact question, expected source evidence, and rerun-repo-match action.
- CODE_REVIEW follow-up assessment interview pages now surface the source-backed question plan and include the primary question in the invite message so evidence calls have a concrete candidate-facing purpose.
- Candidate discovery now persists the exact provider model key used for profile generation, including Workers AI remap/fallback model keys, so repo-match evidence can cite the real inference source instead of only `cloudflare-ai`.
- Workers AI routing now preserves Cloudflare's documented active `@cf/meta/llama-3.1-8b-instruct-fast` variant while still remapping the deprecated non-fast Llama 3.1 models before candidate/repo matching inference.
- Candidate CODE_REVIEW waiting states now expose a six-step pipeline for CV intake, evidence decomposition, repo matching, challenge assignment, review, and scoring instead of collapsing every delay into generic matching copy.
- Public candidate `/assess/:token` links now mount without requiring recruiter Clerk configuration, while recruiter routes still show the missing-auth configuration screen.
- Recruiter CODE_REVIEW details now label blocked repo matching as an assignment/evidence issue and recommend a context call or manual PR selection instead of implying the candidate has not submitted their review.
- Blocked CODE_REVIEW recruiter details now consume a source-backed evidence plan that names the missing signal, why it matters, expected evidence, and the evidence-producing follow-up question.
- Blocked CODE_REVIEW follow-up creation now stores concise evidence questions so recruiters can collect the missing background needed for a fair repo match.
- Blocked CODE_REVIEW evidence-call creation now also creates a source-backed `TECHNICAL` assessment session and immutable evidence-plan event linked to the original match gap and follow-up interview.
- Completed CODE_REVIEW evidence-call transcripts now append source-backed response spans to the evidence-plan assessment and emit a ready-for-repo-match-refresh report.
- Original CODE_REVIEW recruiter details now surface completed evidence-plan follow-up calls as a refresh-ready relationship instead of continuing to show the stale missing-evidence prompt.
- Recruiters can now rerun deterministic CODE_REVIEW repo matching from completed evidence-plan follow-up calls, persisting the refreshed real repo/PR assignment only when the matcher returns a source-backed match and otherwise showing an explicit no-match result.
- CODE_REVIEW context-call refresh state now passes the scheduled interview id through match-detail loading, restoring Worker type-checks for the evidence-plan refresh route.
- Blocked CODE_REVIEW recruiter details now include a context-call CTA that creates a linked video follow-up and stores the original match gaps plus suggested questions as source-backed person context.
- Code-review context-call recommendation persistence now narrows candidate application ids before writing living-context records, restoring Workers type-checks for the scheduling route.
- Automatic CODE_REVIEW matching now requires positive contrast separation before serving a roleless PR, turning near-tie candidate/repo matches into explicit repo-matching attention states instead of overclaiming a best assessment.
- Candidate-facing CODE_REVIEW review-session status now exposes a six-step public pipeline through review and scoring, and the app-dev smoke fails unless completed reviews report durable scoring through that status endpoint.
- Added a CODE_REVIEW app-dev reliability loop that repeats the profile matrix, persists per-run proof artifacts, and fails unless every iteration includes a completed/scored full-submit match plus an explicit blocked repo-matching state with no auto-refresh loop.
- Added a CODE_REVIEW app-dev profile matrix smoke that creates fresh candidates across realistic frontend profiles, verifies full-submit auto-match/browser/pushback/scoring for matchable profiles, and verifies explicit blocked repo-matching diagnostics for an ambiguous near-tie profile.
- CODE_REVIEW recruiter detail pages now lead with a compact recruiter decision summary and keep candidate line-comment details collapsed by default, reducing default screen noise while preserving the audit trail.
- CODE_REVIEW recruiter detail pages now visually prioritize the review assignment, match decision, and submitted review result ahead of scheduling/person-context accounting so the first read answers whether the assessment was useful.
- Recruiter code-review detail pages now lead with review assignment, match decision, assessment fit, and candidate result while moving validator/source-span graph internals into opt-in proof drawers.
- Role-backed CODE_REVIEW matching now separates role/PR relevance from candidate evidence coverage, allowing source-backed sparse candidate decompositions to match strongly role-relevant real PRs without hiding behind terminal no-match states.
- Role-backed CODE_REVIEW matching now treats source-backed selected role-context terms as relevance evidence instead of requiring every selected term to appear in a single PR packet, preventing good partial-overlap review challenges from becoming terminal no-matches.
- CODE_REVIEW PR-author pushback now falls through current Workers AI author models and retries malformed non-empty provider output through a strict JSON repair pass before surfacing `AI_DEVELOPER_UNAVAILABLE`, reducing app-dev review-round stalls without fabricating author replies.
- Standalone CODE_REVIEW matching now blocks stale non-progressing evidence ingestion with candidate-safe diagnostics instead of polling forever behind the generic matching screen, and ingestion step heartbeats update `updated_at` for reliable freshness checks.
- Role-backed CODE_REVIEW matching now converts terminal deterministic no-match outcomes into blocked repo-matching diagnostics instead of repeatedly polling a generic matching screen.
- The CODE_REVIEW app-dev full-submit smoke now polls D1 for durable review-session score reports, challenge-submission scores/reports, and assessment scores so scoring regressions fail the reliability gate.
- Role-backed CODE_REVIEW smoke defaults now use selected terms that appear literally in the generated job description, keeping the role-source validation lane executable.
- Candidate discovery now extracts one balanced JSON object from provider responses that include preamble/trailing text while still rejecting array-shaped or non-JSON output, reducing brittle repo-matching blocks without fabricating evidence.
- Meeting transcript ingestion now requires explicit `attributed` speaker mode before contact ids can create person attribution, semantic assertions, or candidate signals, preventing diarization-adjacent metadata from becoming person evidence by default.
- Stale in-progress standalone candidate evidence builds now requeue source-backed ingestion from the original R2 CV/text source and report a stalled-build retry reason instead of blocking repo matching behind a terminal attention state.
- Scheduled Worker repair now requeues stale/deprecated Workers AI candidate-discovery failures from the original R2 CV/text source in bounded batches and writes append-only retry/failure session events, so old `Challenge needs attention` rows can self-heal without fabricating match evidence.
- Workers AI model routing now remaps all Cloudflare models listed in the 2026-05-30 deprecation catalog before candidate/repo matching inference, preventing stale environment overrides from blocking source-backed challenge discovery.
- Code-review scoring now rejects missing BARS dimension scores, source evidence, or narrative output instead of defaulting incomplete scorer JSON to midpoint assessments.
- Candidate discovery no longer defaults missing or malformed `greenfield_ratio` evidence to `0.5`; repo matching prompts now receive `null` unless the model produced a valid source-backed number.
- Job-description parsing no longer emits a synthetic Senior Backend Engineer baseline from `MOCK_AI`; unavailable role-agent parsing now falls back to source-text-only fields with uncertain requirements left absent.
- Culture interview scoring now fails closed when no real provider, provider output, evidence quotes, or valid scorer JSON is available instead of writing neutral mock score reports.
- Comprehension review scoring no longer emits mock score reports or default midpoint dimensions when scorer providers are unavailable or return incomplete JSON.
- Resume/CV ingestion no longer returns synthetic `Jane Doe` parsed/decomposition data from `MOCK_AI` or parser mock flags; unavailable candidate LLMs now degrade to deterministic source-text parsing or explicit ingestion diagnostics only.
- CODE_REVIEW explainer questions now return explicit `AI_DEVELOPER_UNAVAILABLE` diagnostics when the real provider is missing, empty, failed, or unparsable, instead of writing canned mock explanations into candidate transcripts.
- Standalone dev-container and open-source bug-fix interviews now requeue source-backed candidate ingestion from the original CV/text source after stale Workers AI model failures before claiming repo matching is blocked.
- Standalone repo-task matching now retries recoverable candidate discovery failures for any deprecated or decommissioned Workers AI model, not only the original Llama 3.1 incident string.
- Non-matching candidate-to-PR outcomes now persist `REPO_MATCHING` assessment diagnostics and move the assessment session to `DIAGNOSTIC` instead of leaving missing-evidence states as active progress.
- Candidate-to-PR match runs now append immutable `REPO_MATCHING` assessment evidence with exact `match_runs`, selected packet, role, candidate, and repo source refs instead of existing only as a rebuildable context projection.
- CODE_REVIEW scoring now uses a resilient single-pass Workers AI scorer with current model fallbacks, retries stale `scoring` sessions from the scheduled Worker backlog, and persists the full score report on both `review_sessions` and `challenge_submissions`.
- Standalone CODE_REVIEW matching now derives deterministic source-backed match facets from the candidate's exact CV evidence, preserving repo/domain signals such as Workers/runtime/deployments instead of collapsing rich decomposition evidence into generic TypeScript overlap.
- CODE_REVIEW evidence-plan follow-up calls now persist the same gap-derived, source-backed questions shown in the recruiter UI, asking for codebase context, personal role, trade-offs, verification/tests, and matchable source evidence instead of generic background prompts.
- CODE_REVIEW evidence-plan refresh now requires attributed transcript evidence before marking a follow-up call ready to rerun repo matching, preventing mixed or summary-only audio from masquerading as candidate-backed evidence.
- CODE_REVIEW evidence-plan follow-ups now mark summary-only/mixed transcript recordings as blocked and show recruiters the attribution issue instead of leaving the match-recovery loop in a misleading waiting state.
- CODE_REVIEW evidence-plan follow-ups can now recover from a blocked summary-only recording when a later attributed transcript is captured, moving the same micro-assessment to refresh-ready instead of staying blocked.
- Standalone CODE_REVIEW matching keeps derived CV source terms in the concept channel instead of flooding sparse mechanism/domain dimensions, preventing valid Workers-style matches from being rejected as weak.
- Roleless CODE_REVIEW repo matching now accepts exact, multi-span source-backed candidate/repo alignments at the sparse-decomposition threshold and measures contrast against different repositories instead of same-repo PR near-ties.
- Candidate atom selection now caps only primary decomposed concepts, so exact CV source terms such as cron, schedules, and workflows can support repo matching without excluding other source-backed atoms.
- Workers AI model routing now retries the live default model when Cloudflare reports a stale configured model as deprecated, preserving repo/challenge discovery instead of blocking on old dashboard overrides.
- Workers AI model routing now trims and normalizes stale role-agent overrides before repo discovery inference, preventing dashboard whitespace/case drift from calling deprecated Llama 3.1 models.
- Standalone CODE_REVIEW matching status refresh now requeues real candidate ingestion for stale Workers AI model failures when the original resume source is recoverable, and text-intake CV submissions are stored in R2 under their synthetic source key for future provenance/retry.
- Repo-task assessment reports now reject diagnostic-only `EVALUATED` outputs, requiring missing evidence to persist under an explicit diagnostic status instead of masquerading as a completed evaluation.
- Repo-task assessment evaluation now requires every non-diagnostic claim, including negative outcomes, to cite exact evidence already captured in the same assessment session.
- Repo-task assessment outputs now reject report/output status contradictions, preserving rebuildable evaluation projections from the canonical assessment spine.
- Repo-task assessment diagnostics now preserve exact source refs through evaluation reports and context-record projections instead of dropping diagnostic provenance at the facade.
- Repo-task assessment diagnostics now reject forged source refs that were not previously captured as immutable evidence in the same assessment session.
- Repo-task assessment evaluation claims now preserve caller-supplied confidence through the facade into canonical assessment persistence instead of dropping the qualifier.
- Repo-task assessment diagnostic routes now return the persisted diagnostic row id and evaluation report id, keeping standalone diagnostics traceable to their canonical report.
- Repo-task assessment diagnostics now preserve caller-supplied diagnostic ids in persisted report diagnostics JSON for deterministic projection rebuilds.
### Added — Match run history endpoint + panel (criteria #6, #8)

- `GET /api/v1/candidates/:id/living-context/match-history` — returns chronological match run history with inter-run deltas (status changes, score improvements, new top challenges). Gated by `living_context_read` rollout gate.
- `MatchHistoryPanel` component in `LivingContextGraph.tsx` — shows match run timeline with status badges, top challenge info, and delta indicators (score changes, new matches, status transitions).
- `useMatchHistory` hook (`src/hooks/useMatchHistory.ts`) — fetches match run history with configurable limit.
- Frontend types: `MatchHistoryEntry`, `MatchHistoryDelta`, `MatchHistoryResponse`.
- `matchHistory.test.ts` — 5 Vitest tests: empty state, ordering, JSON parsing, delta computation, limit.
- BDD e2e: §18 (match history runs + entry fields) — 2 new Playwright scenarios.
- Updated `useMatchHistory` mock in all 4 existing LivingContextGraph test files.

### Added — Recruiter re-match button + concept graph visualization (criteria #3, #5, #7)

- `useRematch` hook (`src/hooks/useRematch.ts`) — calls `POST /candidates/:id/living-context/rematch`, returns result/error/loading state. Wired into LivingContextGraph with real-time UI update after successful rematch.
- Re-match button in `LivingContextGraph.tsx` — recruiter can trigger deterministic re-matching from the CONTEXT_GRAPH tab. Shows matched PR info, needs-more-evidence reason, or error state inline.
- `useConceptGraph` hook (`src/hooks/useConceptGraph.ts`) — fetches learned concepts and adjacency edges from `GET /internal/concept-graph` with namespace/query/minObs filters.
- `ConceptGraphPanel` component in `LivingContextGraph.tsx` — renders learned concept cards (label, namespace, observation count, aliases, description), filterable search, and concept edge list with dimension/confidence. Satisfies criterion #3 (dynamic semantics visualization) and #7 (concept graph in the living context view).
- Frontend types: `RematchResult`, `ConceptGraphConcept`, `ConceptGraphAdjacency`, `ConceptGraphResponse`.
- `ConceptGraphAndRematch.test.tsx` — 9 Vitest component tests: concept card rendering, edge display, empty state, filter search, re-match button states (idle/running/matched/needs-evidence/error).
- BDD e2e tests: §16 (rematch endpoint), §17 (concept graph with adjacencies, namespace filter) — 4 new Playwright scenarios.
- Updated hook mocks in all 3 existing LivingContextGraph test files.

### Added — Recruiter-triggered re-match endpoint (criteria #5, #6)

- `POST /api/v1/candidates/:id/living-context/rematch` — allows recruiters to re-run the deterministic candidate-to-PR matcher after new evidence arrives (resume upload, meeting transcript, assessment completion). Returns match status, matchRunId, selected repo/PR, and top challenge diagnostics. Uses temporal decay (90-day half-life) for evidence freshness weighting. Gated by `living_context_read` rollout gate.
- `rematch.test.ts` — 5 Vitest tests covering identity resolution, match result shape, rank selection logic, and insufficient evidence handling.

### Added — BDD Playwright tests for living context graph endpoints

- `e2e/living-context-graph.spec.ts` — 16 BDD scenarios covering all living context API endpoints: person graph read model, source search, timeline, evidence depth, match narrative, evidence gap analysis, match provenance chain, evidence lineage, freshness, aggregation, concept graph, health, integrity, stats, and backfill. Tests seed realistic candidate evidence via the e2e fixture endpoint and verify round-trip source fidelity.

### Added — Vitest component tests for EvidenceGapPanel and MatchProvenancePanel

- `EvidenceGapPanel.test.tsx` — 3 tests covering null report, empty demands, full gap analysis rendering (coverage bar segments, demand cards with badges, matched/missing concepts, supporting assertion quotes, recommendations).
- `MatchProvenancePanel.test.tsx` — 3 tests covering null provenance, empty chain, full provenance chain rendering (decision summary metrics, demand entries with scores, stretch indicators, assertion decay, source span quotes, interaction trace).

### Added — Frontend evidence gap analysis panel (criteria #6, #7)

- `EvidenceGapPanel` component in `LivingContextGraph.tsx` — renders per-demand coverage (strong/partial/weak/none) with a proportional coverage bar, per-demand cards with coverage badge and concept tags (matched in green, missing struck-through), supporting assertion quotes, and actionable recommendations.
- `useEvidenceGaps` hook — fetches gap report from `/api/v1/internal/evidence-gap-analysis` given `candidateId` + `challengePacketId`.
- Frontend types: `EvidenceGapReport`, `DemandCoverage`, `GapSummary`, `CoverageLevel`, `GapSupportingAssertion`.

### Added — Frontend match provenance chain panel (criteria #2, #6)

- `MatchProvenancePanel` component in `LivingContextGraph.tsx` — renders the full decision &rarr; demand &rarr; signal &rarr; assertion &rarr; source provenance chain for a match run, with alignment scores, stretch indicators, temporal decay, and original source text quotes.
- `useMatchProvenance` hook — fetches provenance chain from `/api/v1/internal/match-provenance-chain` given `matchRunId`.
- Frontend types: `MatchProvenanceChain`, `ProvenanceMatchDecision`, `ProvenanceDemandLink`, `ProvenanceSignalNode`, `ProvenanceAssertionNode`, `ProvenanceArtifactNode`, `ProvenanceInteractionNode`, `ProvenanceChainEntry`.

### Added — Evidence gap analysis (criterion #6)

- `evidenceGapAnalysis.ts` — analyzes a candidate's evidence profile against challenge demands, producing a structured report of coverage levels (strong/partial/weak/none), missing concepts, and actionable recommendations.
- `analyzeEvidenceGaps(evidence, demands, options?)` — pure function for gap classification with configurable thresholds.
- `analyzeEvidenceGapsForChallenge(db, candidateId, challengePacketId, options?)` — D1-backed gap analysis loading evidence with temporal decay.
- `GET /api/v1/internal/evidence-gap-analysis` — API endpoint with `candidateId`, `challengePacketId`, and tunable threshold params.
- 11 new tests covering coverage classification, concept matching, weighted scoring, and recommendations.

### Added — Match provenance chain (criteria #2, #6)

- `matchProvenanceChain.ts` — traces a match run end-to-end from decision through demand alignments, candidate signals, semantic assertions, source spans, artifacts, and interactions.
- `loadMatchProvenanceChain(db, matchRunId, options?)` — loads complete provenance chain with temporal decay multipliers at each assertion node.
- `GET /api/v1/internal/match-provenance-chain` — API endpoint with `matchRunId` param.
- 9 new tests covering provenance chain types, stretch vs. direct matches, and unmatched states.

### Added — Frontend evidence lineage visualization (criteria #2, #6)

- `EvidenceLineagePanel` component in `LivingContextGraph.tsx` — renders assertion → source span → artifact → interaction trace with temporal decay coloring (fresh/recent/aging/stale border), concept tags, and original source text quotes.
- `useEvidenceLineage` hook — fetches lineage data from `/api/v1/internal/evidence-lineage` with concept key filtering.
- Frontend types: `EvidenceLineageResponse`, `EvidenceLineageNode`, `EvidenceLineageSourceSpan`, `EvidenceLineageArtifact`, `EvidenceLineageInteraction`.

### Added — Frontend evidence freshness indicators (criterion #7)

- `EvidenceFreshnessPanel` component in `LivingContextGraph.tsx` — stacked proportional bar (fresh/recent/aging/stale) with color legend, median age, and average decay statistics.
- `useEvidenceFreshness` hook — fetches freshness summary from `/api/v1/internal/candidate-evidence-freshness`.
- Frontend types: `EvidenceFreshnessResponse`, `EvidenceFreshnessEntry`, `FreshnessLevel`.

### Added — Temporal concept adjacency in matcher stretch-area (criteria #3, #5)

- `loadStretchAdjacencies()` in `d1Matcher.ts` — loads temporally-weighted concept co-occurrence edges from D1 via `loadTemporalNeighborhood`, converts to `ConceptAdjacency[]` format, and passes them to `recallReviewChallenges` + `alignCandidateToChallenge`. Stretch matching is now active when concept adjacency data exists.
- Graceful degradation: if the `concept_adjacency` table is unavailable (e.g. older migrations), returns empty adjacency set — no stretch matching, no crash.
- Effective confidence threshold: adjacency edges with `effectiveConfidence < 0.2` are filtered out to prevent stale co-occurrences from influencing stretch decisions.

### Added — Evidence lineage tracing (criteria #2, #6)

- `evidenceLineage.ts` — traces match decisions back through the full evidence chain: assertion → source span → artifact → interaction. Includes temporal decay multipliers and effective strength at each node.
- `traceEvidenceLineage(db, candidateId, options?)` — loads the complete lineage with optional concept key filtering and limit.
- Per-node lineage includes: assertion narrative/concepts, source span with exact text/offsets, artifact metadata, interaction provenance, decay multiplier, and effective strength.
- Concept summary aggregates lineage nodes by concept with average effective strength and observation date range.
- `GET /api/v1/internal/evidence-lineage` — API endpoint with `candidateId`, `conceptKeys`, and `limit` query params.
- 7 new tests covering empty states, full chain traversal, temporal decay application, and missing signal handling.

### Added — Concept adjacency temporal weighting (criterion #3)

- `conceptAdjacencyDecay.ts` — applies time-based decay to concept co-occurrence edges so recently reinforced connections are stronger than historical ones.
- `loadTemporalAdjacencies(db, conceptId, decayConfig?)` — loads adjacencies with temporal weight, effective confidence, observation count, and date range. Multiple adjacency records for the same concept pair are aggregated with recency-weighted confidence.
- `loadTemporalNeighborhood(db, conceptIds, decayConfig?)` — batch loads temporally-weighted neighborhoods for multiple concepts.
- `GET /api/v1/internal/concept-adjacency-temporal` — API endpoint with `conceptId`, `halfLifeDays`, and `gracePeriodDays` query params.
- 9 new tests covering decay mechanics, pair aggregation, dimension separation, and neighborhood loading.

### Added — Evidence freshness indicators (criterion #7)

- `evidenceFreshness.ts` — computes temporal freshness metadata for evidence visualization. Classifies evidence as `fresh` / `recent` / `aging` / `stale` with per-entry decay multipliers and effective weights.
- `computeEvidenceFreshness(entries, decayConfig?)` — pure function for freshness classification and summary statistics (counts per level, average decay, median age, date range).
- `loadCandidateEvidenceFreshness(db, candidateId, decayConfig?)` — loads assertion timestamps from D1 and produces freshness summary.
- `GET /api/v1/internal/candidate-evidence-freshness` — API endpoint for freshness data with tunable decay parameters.
- 9 new tests covering classification levels, date tracking, base weight application, and null handling.

### Added — Temporal evidence decay for matcher scoring (criterion #5)

- `temporalDecay.ts` — time-based attenuation of evidence strength with configurable half-life, grace period, and floor multiplier. Evidence within the grace period (default 14 days) retains full weight; older evidence decays logarithmically with a 90-day half-life, never dropping below 25%.
- Integrated into `loadCandidateSignals` in `d1Matcher.ts` — candidate signal strengths are now modulated by evidence freshness before entering the matching pipeline.
- `CandidateReviewChallengeOptions.temporalDecay` — optional override for decay parameters per match run.
- 24 new tests covering decay curve characteristics, boundary conditions, and integration.

### Added — Evidence confidence aggregation (criterion #1, #5)

- `evidenceAggregation.ts` — aggregates multiple observations of the same concept across interactions into composite confidence/strength scores without mutating underlying evidence.
- Corroboration bonus (multiple sources agreeing), diversity bonus (evidence from different interaction types), contradiction penalty, and recency-weighted averaging.
- `loadAggregatedCandidateEvidence(db, candidateId, config?)` — loads and aggregates all concept evidence for a candidate from D1.
- `GET /api/v1/internal/candidate-aggregated-evidence` — API endpoint for aggregated evidence with tunable decay parameters.
- 12 new tests covering aggregation logic, corroboration, diversity, contradictions, and grouping.

### Added — Session event → living context ingestion (criterion #1)

- `ingestSessionEventsToLivingContext(db, candidateId, sessionId, events)` — ingests interview session events (answer_submitted, scoring_complete, question_asked, stage_advanced, match_assigned) across all session types into the living context graph as source-backed assertions.
- `loadSessionEventsForCandidate(db, candidateId, cursor?, limit?)` — paginated loader for session events by candidate.
- Backfill task `session_events_to_living_context` added to `BackfillOrchestrator` — processes un-ingested sessions from the `session_events` table.
- Each evidence event generates: an episode, artifact version (per-event payload), source span, semantic assertion with extracted concepts, and concept links.
- Idempotent: skips already-ingested events via ingestion_key deduplication.
- 10 new tests covering answer ingestion, scoring events, non-evidence filtering, idempotency, multi-event sessions, null payloads, and pagination.

### Added — Real-time assessment → living context ingestion (criterion #2, #5)

- Assessment evidence now flows into the person graph immediately when an evaluation report is created (`POST /sessions/:sessionId/evaluation-reports`), rather than waiting for the scheduled backfill cron.
- Extracted `loadAssessmentSessionData(db, sessionId)` as a shared helper used by both the real-time hook and the scheduled backfill, eliminating duplicated data-loading logic.
- `ingestAssessmentSessionRealTime(db, sessionId)` — single-call convenience that loads + ingests in one step.
- Backfill `backfillAssessmentsBatch` refactored to use the shared loader.
- 4 new tests covering `loadAssessmentSessionData` and `ingestAssessmentSessionRealTime`.

### Added — Person identity link endpoint (criterion #1)

- `POST /api/v1/internal/person-identity-link` — manually merge a contact and candidate onto the same person node when email-based auto-resolution cannot merge them (different emails, missing email, etc.).
- Re-points all dependent records (interactions, artifacts, episodes, assertions, signals, person roles, context records) from the source workspace person to the target, then deletes the orphaned source workspace person.
- Merges display name and email from the source person if the target person is missing them.
- 4 new tests covering validation, not-found handling, cross-email merge, and same-email already-linked detection.

### Added — Contact living context parity (criterion #1)

- `GET /api/v1/cockpit/contacts/:id/living-context/timeline` — chronological evidence accumulation feed for contacts. Resolves contact → workspace person via `context_json` and delegates to `loadPersonEvidenceTimeline`. Supports `limit`, `before`, `after` pagination. Gated behind `living_context_read`.
- `GET /api/v1/cockpit/contacts/:id/living-context/evidence-depth` — per-source-type evidence scoring for contacts. Returns source diversity, interaction breakdown, assertion/source-span/context-record counts, and top 20 learned concepts by evidence count. Gated behind `living_context_read`.
- 6 new tests covering empty state, workspace person resolution, timeline loading, source diversity computation, and top concept extraction.

### Added — Evaluation run endpoint (criterion #8)

- `POST /api/v1/internal/evaluation-run` runs the full matching evaluation pipeline against a stored corpus and returns structured metrics (recall@50, precision@3, nDCG@5, guardrail violations, determinism proof, pair/packet coverage). Optionally persists results for rollout gate readiness checks. Returns human-readable report alongside structured JSON.
- 3 new tests covering missing corpusId validation, non-existent corpus handling, and successful evaluation with sample corpus fixture.

### Added — Concept graph query endpoint (criterion #3)

- `GET /api/v1/internal/concept-graph` queries the learned concept taxonomy. Returns concepts with canonical keys, namespaces, labels, aliases, observation counts, and timestamps. Supports filtering by `namespace`, substring search via `q`, minimum observation count via `minObs`, and optional adjacency edge inclusion via `withAdj=true`.
- 7 new tests covering empty state, ordering by observation count, namespace filtering, query string filtering, minObs filtering, adjacency inclusion, and adjacency omission by default.

### Added — Evaluation corpus seeder (criterion #8)

- `POST /api/v1/internal/evaluation-corpus-seed` extracts evaluation corpus data from real match decisions in D1. Loads candidate living context evidence (assertions + source spans), role requirements, challenge packets, and generates draft expert labels from match scores. Draft labels are marked `labeledBy: 'corpus-seeder'` so they fail the production corpus gate until experts upgrade them.
- `seedCorpusFromMatchRuns(db, options)` in `evaluation/corpusSeeder.ts` — orchestrates the extraction pipeline with configurable `limit`, `statusFilter`, `roleContextId` filters.
- `persistSeededCorpus(db, corpus)` — persists the generated corpus to `evaluation_corpora` for subsequent evaluation runs.
- 5 new tests covering empty state, full provenance extraction, persistence, orphan warnings, and status filtering.

### Added — Data integrity validation endpoint (criterion #8)

- `GET /api/v1/internal/living-context-integrity` validates referential integrity across the living context entity chain: persons → workspace_people → interactions → episodes → assertions → source_spans, plus context record source ref coverage and source span non-emptiness. Returns per-check pass/fail with counts of orphaned or dangling entities.
- 7 integrity checks: workspace_people↔person, interactions↔workspace_person, assertions↔source_spans, context_records↔source_refs, source_span non-empty text, episodes↔workspace_person, projection outbox staleness.
- Added 3 tests covering healthy graph, orphaned assertions detection, and empty graph.

### Added — Standalone evaluation readiness endpoint (criterion #8)

- `GET /api/v1/internal/evaluation-readiness?corpusId=...&stage=shadow|canary|production` provides a read-only evaluation readiness check without triggering gate progression. Returns the full readiness report including metrics, failures, warnings, and a human-readable report text.
- Added 3 tests covering missing corpusId, no evaluation result, and invalid stage.

### Added — Rollout gate enforcement on living context API routes (criterion #8)

- All living context read endpoints (`/living-context`, `/living-context/search`, `/living-context/timeline`, `/living-context/match-narrative`, `/living-context/evidence-depth`) on both candidate and contact routes are now gated behind the `living_context_read` rollout gate via `requireGate` middleware. When the gate is `disabled`, these endpoints return 404 — features appear non-existent until promoted through `internal_only → canary → GA`.
- Refactored `requireGate` to use `createMiddleware` from `hono/factory` for proper Hono type compatibility across all route configurations.
- Added 5 new tests verifying gate enforcement across all stages and audit trail integrity.

### Added — Concept co-occurrence adjacency tracking (criteria #3)

- During resume and meeting transcript ingestion, when an assertion references 2+ concepts, all concept pairs are now recorded as `co_occurrence` adjacencies in `concept_adjacency`. This builds a learned graph of related skills/topics from evidence — e.g., "React" and "TypeScript" appearing in the same experience assertion creates an adjacency link.
- Uses deterministic IDs and `ON CONFLICT DO NOTHING` for idempotent replay.
- Added 1 test verifying 3 concepts produce 3 adjacency pairs with correct dimension and provenance.

### Added — Evidence diversity gate in matcher (criteria #5/#8)

- Added configurable evidence diversity gate to `matchCandidateToReviewChallenge`. When `minEvidenceDiversity` or `minEvidenceInteractions` thresholds are set and the candidate's evidence depth falls below them, the matcher returns `NEEDS_MORE_EVIDENCE` early — preventing unreliable matches from sparse evidence.
- Defaults are lenient (0/0) to preserve existing behavior; callers opt into stricter gating by passing higher thresholds.
- Added 3 new tests covering diversity-below-threshold, default-preserving behavior, and interaction-count gating.

### Added — Evidence depth integration in match diagnostics (criteria #5/#7/#8)

- Evidence depth is now computed and included in `ChallengeMatchDiagnostics.candidateEvidenceDepth` during every match run. This gives recruiters and the quality gate visibility into how many distinct source types (resume, meeting, culture interview, code review, phone call, assessment) contributed evidence before a match decision was made.
- Added `EvidenceDepthPanel` component to `LivingContextGraph.tsx` — renders a 6-segment visual bar showing which source types have evidence and how many interactions each contributed. Displayed between the summary metrics and the meeting evidence panels.
- Added CSS for evidence depth visualization with responsive grid layout.

### Added — Assessment evidence → living context ingestion (criteria #1/#2/#8)

- Added `assessmentIngestion.ts` module: bridges the assessment layer (assessment_sessions, assessment_evidence_events, assessment_evaluation_claims) into the living context graph. Each assessment session maps to an interaction; evidence events map to episodes + assertions with exact source spans; evaluation claims map to assertions with source provenance and polarity tracking.
- Added `assessments_to_living_context` backfill task to the scheduled orchestrator (10th task, depends on `candidates_to_living_context`). Cursor-based batch processing of assessment sessions with state NOT IN ('INTAKE', 'CANCELLED'). Loads related evidence events, event source refs, evaluation reports, claims, and claim source refs per session.
- Wired assessment backfill into `projection_outbox_drain` dependency graph so projection output includes assessment-derived entities.
- Added 4 tests covering null-candidate guard, event+assertion+context-record ingestion, evaluation claim ingestion with polarity tracking, and idempotency.

### Added — Candidate evidence depth endpoint (criteria #7/#8)

- Added `GET /api/v1/candidates/:id/living-context/evidence-depth` endpoint — returns per-source-type evidence scoring including source diversity (0–1), total counts for interactions/assertions/source spans/context records, per-type breakdown, and top 20 concepts ranked by evidence count.
- Source diversity metric: ratio of distinct interaction types present vs maximum possible (6: resume, meeting, culture interview, code review, phone call, assessment). Helps recruiters and the quality gate assess whether a candidate has enough independent evidence sources for a reliable match.
- Added 4 new tests covering zero-state, source diversity computation, top concepts ranking, and full-diversity scenarios.

### Added — Person evidence timeline API (criterion #7)

- Added `GET /api/v1/candidates/:id/living-context/timeline` endpoint — returns a chronological feed of evidence accumulation merging interactions, assertions, and context records into a single time-ordered stream. Supports pagination via `limit`, `before`, and `after` query parameters.
- Added `loadPersonEvidenceTimeline` function to `readModel.ts` — queries interactions, semantic assertions (joined through episodes), and context records for a workspace person, then merges and sorts them chronologically.
- Added 3 new tests covering timeline generation, pagination, and empty-person edge case.
- Directly enables "Show evidence accumulating across interactions" requirement from acceptance criterion #7.

### Added — Rollout gate management API (criterion #8)

- Added `POST /api/v1/internal/rollout-gate` endpoint to transition feature gates between stages (disabled → internal_only → canary → GA) with audit logging. Accepts `{ gateKey, stage, reason? }`.
- Added `GET /api/v1/internal/rollout-gate/gates` endpoint to list all configured gates with current stages.
- Added `GET /api/v1/internal/rollout-gate/audit?gateKey=...` endpoint to query the immutable audit trail for gate transitions.
- Added `POST /api/v1/internal/living-context-backfill-trigger` endpoint to manually trigger backfill runs outside the cron schedule.
- Fixed rollout gate check bug in `backfillScheduled.ts`: `checkGate()` returns a `GateCheckResult` object (always truthy), but the code compared it as a boolean — gate enforcement was never blocking disabled backfills.
- Added 6 new endpoint tests covering gate creation, stage transitions, validation, gate listing, and audit trail queries.

### Added — Repository assertions backfill into living context (criterion #4)

- Added `repo_assertions_to_living_context` backfill task to scheduled orchestrator. Iterates all `repo_semantic_assertions` without corresponding context records and creates source-backed context records with full provenance (source spans, line ranges, file paths) and concept linkage via repo facets.
- Ensures all historical repository decomposition data (structural facts, code episodes, semantic assertions) flows into the searchable living context model — not just challenge packet summaries.
- Skips assertions without source spans to avoid orphan records.
- Added 4 tests covering ingestion with source provenance, idempotency, and graceful skip behavior.

### Added — Culture interview session backfill (criterion #1/#8)

- Added `culture_sessions_to_living_context` backfill task to the scheduled cron runner. Existing culture interview sessions (scored/completed/scoring) with transcripts are now replayed through `ingestHistoricalCultureTranscript`, creating per-turn source spans, context records, and enqueuing neo4j projections. The backfill covers the 8th entity type, completing full-graph coverage for all interaction types.
- Added `backfillCultureSessionsBatch` with cursor-based batch processing, `NOT EXISTS` deduplication against the `interactions` table, and standard error isolation per session.
- Wired culture backfill into `projection_outbox_drain` dependency chain so projections drain after culture ingestion completes.
- Added integration test verifying culture transcript backfill creates interactions, artifacts, source spans, context records, and is idempotent on re-run.

### Added — Automated rollout gate progression (criterion #8)

- Added `POST /api/v1/internal/rollout-gate/auto-progress` endpoint — checks evaluation readiness for the next stage and transitions the gate if metrics pass. Enforces single-step progression (disabled → internal_only → canary → GA) with quality gates at each level.
- Bootstrap progression (disabled → internal_only) proceeds without evaluation; subsequent stages require passing evaluation readiness checks at increasing threshold levels.
- Supports `dryRun` mode to preview progression decisions without mutating gates.
- Added 5 new tests covering bootstrap, blocking, terminal state, dry-run, and full progression with evaluation.
### Added — Real-time living context ingestion on resume upload

- Wired `ingestResumeToLivingContext` into `processResumeFromR2` so resumes enter the living context graph immediately upon upload — no longer deferred to scheduled backfill cron. Both recruiter upload and candidate INTAKE submission paths now trigger real-time ingestion.
- Added integration test `enrichment/__tests__/resumeIngestion.test.ts` verifying real-time hook behavior (4 tests).

### Added — Production observability endpoints (criterion #8)

- Added `GET /api/v1/internal/living-context-stats` — returns per-entity-type counts (people, workspace_people, interactions, artifacts, source_spans, assertions, context_records, concepts, signal_evidence, signal_snapshots, semantic_relationships) plus interaction type and artifact type breakdowns. Essential for monitoring staged rollout ingestion progress.
- Added `GET /api/v1/internal/living-context-backfill` — returns per-task backfill checkpoint detail including cursor position, items processed/failed, progress percentage, duration, description, dependency status, and timing. Provides granular visibility into the 7-task backfill orchestrator during production rollout.
- Added 4 new tests covering both endpoints (entity counts with populated graph, empty graph, per-task checkpoint detail, unavailable table handling).

### Added — Match narrative visualization in LivingContextGraph (criterion #6/#7)

- Added `MatchNarrativePanel` component to `LivingContextGraph.tsx` — renders the recruiter-facing match narrative inline with title, verdict, and structured sections (strong alignments, evidence gaps).
- Added CSS for `.living-context__match-narrative` and `.living-context__narrative-section` panels.
- Added 2 tests: narrative panel renders when `matchNarrative` is present; hides when null.

### Added — Match narrative API endpoint (criterion #6)

- Added `GET /api/v1/candidates/:id/living-context/match-narrative` endpoint serving recruiter-facing human-readable match narratives with strength-classified evidence alignments, stretch areas, and evidence gaps linked to original source locators.
- Wired `matchNarrative` field into the candidate profile response (`standaloneReviewMatch` object) so the frontend can display match narratives inline without a separate API call.
- Added `buildNarrativeFromResult` bridge function that reconstructs `MatchExplanation` from stored `ranked_results_json` data and generates narratives via the existing `formatMatchNarrative` formatter.
- Added `StandaloneReviewMatchNarrative` and `MatchNarrativeSection` frontend types.
- 7 new tests covering narrative generation, strength classification, stretch areas, evidence gaps, and all match statuses (168 files, 1536 tests, 0 failures).

### Added — Complete scheduled backfill for all entity types (criterion #1/#8)

- Extended `runScheduledBackfill()` with 3 new dependency-ordered tasks: `meetings_to_living_context`, `phone_calls_to_living_context`, `code_reviews_to_living_context`. The scheduled cron now covers all 7 entity types that accumulate person context (candidates, contacts, resumes, meetings, phone calls, code reviews). Projection outbox drains after all ingestion tasks complete.
- Meeting backfill ingests stored `transcript_json` via `parseStoredMeetingTranscript` → `ingestMeetingTranscriptToLivingContext`, creating per-segment source spans with exact positions.
- Phone call backfill ingests transcriptions, recordings, and recruiter notes via `ingestPhoneCallToLivingContext` + `ingestPhoneRecruiterNote`.
- Code review backfill ingests completed session transcripts and score reports via `ingestCodeReviewTranscriptToLivingContext` + `ingestCodeReviewScoreReportToLivingContext`.

### Added — Native resume ingestion + scheduled backfill

- Added `ingestResumeToLivingContext()` for native resume-to-living-context ingestion — splits resume text into structural sections, creates per-section source spans with exact char/byte/line positions, dynamically learns concepts, creates signal evidence at appropriate evidence levels, and enqueues neo4j projections. Fully idempotent. Supports pre-extracted LLM semantic assertions. (criteria #1, #2, #3)
- Added `splitResumeIntoSections()` — detects uppercase heading patterns to split resume text into typed sections (summary, experience, education, skills, etc.), with paragraph-based fallback.
- Added `runScheduledBackfill()` — scheduled backfill runner with 4 dependency-ordered tasks (candidates → contacts → resumes → projection drain), cursor-based batch processing, gated by `living_context_backfill` rollout gate. Wired to Workers cron `scheduled` event. (criterion #8)
- Added 14 new tests in `resumeIngestion.test.ts` verifying idempotency, source span creation, concept extraction, signal evidence, context records, and projection job enqueue.

### Added — Orchestrated backfills and rebuildable projections (criterion #8 hardening)

- Wired `BackfillOrchestrator` into `backfillLivingContext.ts` — all 7 entity backfill tasks (candidates, contacts, candidateNodes, meetings, cultureSessions, phoneCalls, codeReviewSessions) now track D1-persisted checkpoint cursors with dependency ordering. Interrupted runs resume from the last committed cursor instead of re-processing from the start.
- Added `scheduleFullProjectionRebuild()` to the projection module — enqueues rebuild jobs for all workspace persons through the projection outbox. D1 remains the source of truth; Neo4j projections can be deleted and reconstructed at any time.
- Added `POST /api/v1/internal/living-context-rebuild-projections` endpoint for triggering a full projection rebuild via the outbox cron.
- Added 2 new tests for projection rebuild endpoint; test suite now at 1515 tests across 166 files, 0 failures.
### Added — Staged rollout proof (criterion #8 completion)

- Added `stagedRolloutProof.test.ts` (10 tests) — comprehensive integration test proving the full shadow → canary → production promotion flow: expert-labelled corpus validation, evaluation metrics at all stages, D1-backed gate transitions with immutable audit trail, backfill orchestrator completion before promotion, rollback verification, determinism proof through comparison run fingerprints.
- Expert-labelled evaluation corpus fixture with reviewer provenance (reviewerId, reviewArtifactId, contentHash, rubricVersion) passes both standard and production corpus validation.

### Added — Production infrastructure for living context graph

- Added D1 migrations `0106_backfill_checkpoints`, `0107_rollout_gates`, `0108_rollout_gate_audit_log` for idempotent backfill tracking, feature rollout gates, and immutable gate transition audit trail.
- Added `BackfillOrchestrator` with dependency-aware multi-task checkpoint tracking — tasks resume from the last committed cursor on restart (criterion #8 deterministic idempotent backfills).
- Added `rolloutEnforcement` module with `checkGate()`, `requireGate()` middleware, `gatedField()`, `updateGateStage()`, `listGates()`, and `queryAuditLog()` — D1-backed feature rollout gates with 60-second in-memory cache and immutable audit trail (criterion #8 staged rollout).
- Added `formatMatchNarrative()` for recruiter-facing human-readable match explanations — classifies evidence as strong/moderate/partial, separates stretch areas from gaps, links to source locators (criterion #6 explain every match).
- Added `GET /api/v1/internal/living-context-health` endpoint for per-subsystem health checks: required tables, rollout gates, backfill orchestrator status, projection outbox health (criterion #8 production quality).
- Added proof test suites: `backfillOrchestrator.test.ts` (8 tests), `rolloutEnforcement.test.ts` (6 tests), `matchNarrative.test.ts` (6 tests), `livingContextHealth.test.ts` (2 tests) — 22 new tests for production infrastructure.

### Added — Living context graph & match explanation completeness

- Added `searchSourceContent()` to the living context read model for cross-artifact semantic source search (criterion #2). Searches all source spans linked to a workspace person, falls back to assertion narratives when no spans match, and returns hits with citing assertions, context records, and concept keys.
- Added `GET /api/v1/contacts/:id/living-context/search?q=...` and `GET /api/v1/candidates/:candidateId/living-context/search?q=...` endpoints for recruiter-facing source content search.
- Surfaced `stretchAreas` and `unmatchedDemandIds` through the standalone review match API and frontend types (criteria #6/#7). Each alignment now includes its `stretch` field (dimension, atomConcept, demandConcept), and the match record exposes derived stretch areas and unmatched demand IDs.
- Added `StretchAreasPanel` and `UnmatchedDemandsPanel` UI components to the living context graph visualization, rendering stretch dimensions with source refs and unmatched PR demands with concept keys.
- Added `GET /api/v1/internal/rollout-gate?stage=shadow|canary|production` endpoint for live rollout readiness checks against the staged acceptance thresholds (criterion #8).
- Added proof test suites: `searchSourceContent.test.ts` (9 tests), `rolloutGate.test.ts` (7 tests), `matchExplanation.test.ts` (4 tests) — validating criteria #2, #5/#6, and #8.

### Fixed — Test suite stabilization

- Migrated `backfillLivingContext.ts` from `node:sqlite` to `better-sqlite3` with D1-style `?N` param rewriting, fixing `No such built-in module` on Node 20.
- Added missing `packet_json` column to `checkReviewChallengeGraphReadiness` test fixtures, fixing `no such column: rcp.packet_json` schema mismatch.
- Added `it.skipIf(!hasGo)` guard to Go parser test in `sourceAnalysis.test.ts` so CI skips gracefully when Go toolchain is absent.

### Added — Full-pipeline E2E proof test

- Added `fullPipelineE2E.test.ts` exercising the complete lifecycle across all 8 acceptance criteria in a single coherent test: contact creation → meeting transcript ingestion → identity unification → dynamic concept learning → repo semantic graph → source-backed PR challenge → evidence-based matching → match narrative generation → source content search → read model verification → backfill orchestrator checkpointing with dependency ordering.
- Added determinism proof test verifying that re-running matching with identical data yields identical results (criterion #8).

### Fixed — CI stabilization

- Fixed `resolveDevContainerApiBase` to return `http://localhost:8787` for localhost when runtimeLocation is provided, fixing failing frontend test.
- Suppressed pre-existing lint errors: `no-control-regex` in ANSI escape regex (`terminalProtocol.ts`), `no-constant-condition` in SSE reader loop (`useRoomStatusNotifications.ts`).

### Fixed — open-source assessment room layout tools

- Room entry now opens the default video/chat/workspace panels synchronously before switching surfaces, preventing users from landing on an empty call-stage background after pressing Enter room.
- Room entry now keeps the prejoin lobby return after all room hooks are registered, preventing React hook-order crashes when pressing Enter room.
- Recording snapshots now require the stored room state to reconstruct to source-backed browser MediaRecorder evidence before the room client hydrates recording indicators.
- Media-control snapshots now carry the accepted source-backed browser control evidence into Durable Object state and reject source-thin snapshot hydration in the room client.
- Agent/Devin interaction events now require source-backed browser or bridge provenance before local optimistic display, peer replay, or snapshot hydration, preventing source-less assistant state from appearing as real evidence.
- Room Chat messages now require source-backed browser chat evidence with stable room message ids, client ids, timestamps, lengths, delivery status, surface, and room phase before local optimistic display, peer replay, ACK handling, or room snapshot hydration.
- Meeting transcript evidence now preserves the origin of speaker metadata, distinguishing browser-uploaded channel maps from R2 custom metadata recovered during transcript retry, so speaker attribution remains source-backed across processing passes.
- Rejected Room Chat sends now preserve the Durable Object rejection reason in browser evidence and exact source-ref metadata, so failed chat delivery is explainable instead of only marked as not sent.
- Assessment terminal command/output events now require source-backed browser terminal evidence before local optimistic state or peer replay can show terminal activity, preventing source-less command/output claims from appearing while disconnected or before Durable Object validation.
- Code-server file events now require source-backed Agent bridge workspace evidence before local optimistic state or peer replay can show editor saves/changes, preventing source-less editor activity from appearing while disconnected or before Durable Object validation.
- Video media controls and recording state now require source-backed browser/MediaRecorder evidence before local optimistic state or peer replay can change call indicators, preventing source-less mute/camera/recording claims from appearing before Durable Object validation.
- Historical layout events required source-backed surface, menu, lifecycle, data, state, or workspace observer evidence before local optimistic state or peer replay could change shared layout state.
- Assessment file-manager opens now preserve `assessment_file_system` lifecycle provenance, and `.link` file opens emit source-specific browser navigation evidence instead of being flattened into generic layout launches.
- Assessment browser reload and external-open clicks now emit source-backed browser navigation evidence, so repeated or blocked-site browsing remains synced and replayable across shared layout sessions.
- Agent/Devin bridge evidence now carries a hashed Devin API run reference through prompt handoffs, API responses, browser fallbacks, and source refs so real agent interactions remain joinable without exposing raw provider session ids.
- Agent/Devin control suggestions no longer render as executable layout controls, preventing source-less action hints from implying real agent provenance.
- Agent/Devin chat replies now require bridge-observed timestamps and persistence state before rendering as agent messages, preventing source-thin responses from being shown as real Devin output.
- Dev-container sessions now clear stale live error messages when the real container recovers to a non-error state, while preserving the original failure as immutable assessment evidence.
- Blocked Agent chat submits now stay typeable and persist replayable source-backed non-delivery evidence with exact prompt text, prompt fingerprint, and readiness reason instead of silently disabling the input or implying Devin received the message.
- Failed video-room recording stops now broadcast and persist source-backed browser failure stage/source/message facts, while vague failed recording states are rejected instead of entering the evidence graph.
- Candidate ingestion status now queues a source-backed retry for stale Workers AI model failures, so the challenge wait screen can recover from deprecated-model errors instead of replaying an old terminal failure.
- Agent control routing now rejects unsupported bridge control shapes instead of relabeling old agent suggestions as human prompt actions, while still allowing file-change observations to offer a user-clicked workspace prompt.
- Agent/Devin can now use a real Devin service-user API session from the dev-container bridge, preserving API replies as `agent_api_response` source-backed evidence instead of requiring CLI login or relabeling API output as stdout.
- Candidate dev-container launches now pass the real Devin bridge configuration into the server-side container init payload without returning secrets to the browser, keeping Agent chat eligible for real-agent operation outside meeting-room launches.
- Dev-container expiry/manual teardown now marks intentional container stops before destroy, preventing normal `EXPIRED` sessions from retaining false "container stopped unexpectedly" diagnostics in UI and evidence projections.
- Agent/Devin bridge diagnostics, auth/status messages, bridge suggestion text, and real stdout fallback evidence now redact service tokens, bearer tokens, room tokens, and secret query parameters before browser evidence, Durable Object broadcast/storage, or session-event persistence; secret-bearing agent chat is rejected instead of rewriting fingerprinted evidence.
- The container Agent/Devin bridge now redacts real agent stdout and bridge suggestion text before WebSocket broadcast and direct `session-events` persistence, so bridge-origin evidence hashes the same redacted text as browser fallback evidence.
- Agent/Devin bridge status and diagnostic events now emit direct exact-text `agent_status` / `agent_diagnostic` source refs in living-context and assessment evidence instead of only being citeable through the broad meeting-session packet.
- Workspace-state diagnostics now redact room tokens, Devin/Cognition tokens, API keys, bearer tokens, and secret query parameters in both browser-built evidence and the VideoRoom Durable Object activity log.
- Standalone dev-container launches now mark candidate sessions `ERROR` with a redacted diagnostic when the background Durable Object init request fails before the container can report status, and the status API returns that diagnostic to the UI.
- Room workspace launches now mark dev-container sessions `ERROR` with a redacted diagnostic when the background Durable Object init request fails before the container can report status, preventing broken workspaces from polling forever as `LAUNCHING`.
- The assessment assistant entrypoint now reflects whether the Agent chat panel is actually open, while keeping assistant access available after prompt dismissal or chat close for the next real-agent interaction.
- Authoritative room state snapshots now remove stale locally optimistic assessment panels that are no longer accepted by the Durable Object while preserving local bootstrap call/chat/workspace panels, preventing rejected or missed close events from leaving participants on different room states.
- Rejected room-state events now return the Durable Object's authoritative assessment surface snapshot, allowing clients to roll back optimistic local assessment/standard-call state when source-backed evidence is refused.
- Reconnected room clients now re-apply the Durable Object's authoritative assessment surface snapshot unless a fresh local surface toggle is still pending, keeping host and guest aligned when one returns from the open-source assessment room to the standard call after the other briefly disconnects.
- Transcript-derived assertion context records now preserve self-contained exact-text `source_span` refs with content hashes, segment locators, speaker roles, timestamps, provider confidence, and contact attribution so scored/person evidence can cite the spoken moment without reconstructing it from a broader transcript packet.
- Source-backed assessment room surface changes, menu toggles, browser navigation, panel lifecycle/data/state updates, presence samples, media controls, recording state, workspace state, and code-server opens now emit direct source refs and graph entities in living-context and assessment evidence instead of only the broad meeting-session event packet.
- Agent UI actions and real bridge suggestions now preserve direct exact-text source refs in living-context and assessment evidence, so tray clicks, chat closes, auth intents, and agent suggestions are citeable without unpacking the broader room event packet.
- Room chat, Agent user messages, and real agent stdout replies now preserve direct exact-text source refs in living-context and assessment evidence, so chat turns can be cited without unpacking the broader room event packet.
- Code-server file saves/deletes now preserve direct `code_server_file_observation` source refs in living-context and assessment evidence, keeping observed path/action/hash/size/preview/workspace provenance citeable without pretending the full file body was captured.
- Container terminal commands and output chunks now preserve direct `terminal_command` / `terminal_output` exact-text source refs in living-context and assessment evidence, so terminal activity can be cited without unpacking the broader room event packet.
- Room chat evidence now fails closed unless Durable Object messages and replayed room activity carry browser chat source, stable message identity, actor, delivery status, surface, room phase, and exact message length, preventing forged chat claims from entering meeting-session evidence.
- Code-server file-change evidence now fails closed unless bridge metadata includes a real workspace session, observed timestamp, SHA-256 content hash, and size, preventing browser-only events that room replay would reject.
- Agent workspace file-change observations now require code-server bridge source, observed timestamp, SHA-256 content hash, file size, and persistence state before rendering a workspace suggestion, preventing source-less agent messages from implying a real edit.
- Container terminal command/output evidence now fails closed until a real workspace session exists, preventing browser-only terminal events that the room Durable Object would reject from entering the context graph.
- Agent chat now shows a live bridge readiness checklist for workspace, WebSocket, agent identity, state, and capabilities with distinct status dots, so disabled Devin chat is diagnosable without enabling fake or source-less messages.
- Host recording start/stop/upload state now persists through the room Durable Object, with source-backed MediaRecorder provenance replayable into session evidence instead of remaining host-local UI state.
- Historical panel-state evidence preserved whether state changes came from the assistant control or panel control instead of collapsing every update to a generic room source.
- Historical agent-opened assessment tools persisted explicit lifecycle evidence instead of misattributing those opens to direct layout UI clicks.
- Agent’s Devin login terminal button now records `open-devin-auth-terminal` evidence instead of the generic `open-terminal` action id.
- Agent’s browser-based Devin auth button now records `open-devin-auth-browser` evidence instead of collapsing the click into a CLI auth recheck.
- Room Chat’s agent launcher records browser provenance instead of misattributing the Agent open action to the assessment layout.
- Closing the Agent chat panel closes only the chat panel and persists a browser assistant-panel close action, keeping the assessment assistant entrypoint mounted for the next real-agent interaction.
- Agent chat’s generic “Open Terminal” button now records source-backed human UI intent before opening the terminal panel.
- Agent “Check Devin auth” clicks now emit source-backed human UI action evidence before the bridge re-runs real Devin CLI auth preflight, keeping auth recovery intent separate from bridge diagnostics.
- Agent auth-needed chat now includes a real “Check Devin auth” retry after terminal login, reusing the container bridge auth preflight so Devin only becomes ready after the CLI reports a stored login.
- Summary-only meeting transcript analysis now strips model-produced semantic assertions from stored analysis JSON and records suppression metadata, preventing mixed-audio transcripts from leaving candidate-shaped claims outside the source-backed ingestion gate.
- Agent auth-needed chat now opens the real container terminal and queues `devin auth login --force-manual-token-flow` for the user, while terminal evidence redacts auth tokens before commands/output are persisted.
- Agent/Devin now preflights real `devin auth status` before starting the CLI, treats service API keys as insufficient for CLI login, and surfaces precise auth-needed diagnostics in the live agent state.
- Agent/Devin bridge readiness now requires an actual Devin CLI executable in the dev-container image, passes optional `DEVIN_ORG_ID` into room-scoped containers, and emits real missing-CLI/auth-needed diagnostics instead of reporting `AGENT_READY` when Devin is absent or login is canceled.
- Dev-container Durable Object lifecycle hooks now persist source-backed `SLEEPING`, wake-to-`READY`, and unexpected-stop/error diagnostics, keeping Agent availability and workspace evidence aligned with the real container state.
- Historical peer-presence samples published source-backed evidence through the room Durable Object, while raw live-only samples were excluded from replay.
- Room-end Durable Object replay now maps accepted mic/camera control activity into source-backed `media_control` meeting-session evidence, instead of relying only on one browser's direct event capture.
- Mic/camera toggles now publish source-backed media-control events through the room Durable Object, persist replayable activity/state, and render peer media status in the assessment room.
- Room chat delivery acknowledgements and rejections now persist as source-backed `chat_message` evidence immediately, so the live context graph records the Durable Object delivery outcome instead of only the optimistic browser send.
- Dev-container agent startup now requires an explicit supported `AGENT_TYPE` through the meeting launch path and bridge runtime instead of defaulting missing or unsupported agent configuration to Devin.
- Agent chat UI now waits for an explicit container bridge agent identity before enabling chat or naming Devin, preventing the room surface from visually implying a fake agent is connected.
- Browser-side Agent/Devin evidence builders now fail closed when bridge agent identity is missing, preventing room clients from defaulting source-less fallback/status evidence to `devin`.
- Agent/Devin container diagnostics now fail closed when agent identity is missing, preventing the bridge helper from fabricating `devin` on source-less diagnostics or chat responses.
- Agent/Devin agent replies now expose normalized browser prompt correlation refs in meeting-session context records and compact agent context summaries, so rebuildable hypergraph projections can join prompt and response evidence without guessing.
- Agent/Devin browser prompt correlation refs are now validated across HTTP session ingestion, Durable Object room sync, and replay projections, rejecting malformed agent-output evidence instead of accepting loose prompt-link JSON.
- Real Agent/Devin stdout responses now preserve the browser prompt id that caused the bridge handoff, letting the hypergraph join user chat, stdin delivery diagnostics, and agent output without guessing.
- Agent CHAT frames now carry a stable browser prompt id into the real dev-container bridge, and bridge handoff diagnostics preserve the same prompt reference after stdin delivery attempts for source-backed hypergraph correlation.
- Agent user prompt evidence now distinguishes browser-queued CHAT frames from confirmed bridge delivery, and HTTP, Durable Object, and replay validators reject stale prompt evidence that claims bridge delivery.
- Agent/Devin container bridge diagnostics now redact bare Cognition/Devin service-token strings before they can appear in chat, session events, or hypergraph evidence.
- Agent user-prompt evidence now records browser-to-bridge CHAT submission without Devin attribution, and HTTP, Durable Object, and replay validators reject human prompts that stamp an agent identity.
- Room assessment evidence now preserves explicit Agent/Devin bridge agent identity from `agent`/`agentName` metadata and leaves missing agent ids absent instead of defaulting assessment actors to Devin.
- Agent UI action evidence from tray and prompt clicks now rejects any agent attribution server-side, keeping human Agent interactions separate from real Devin bridge evidence.
- Agent bridge validators now reject executable UI-control claims across HTTP session events, Durable Object replay, graph replay, and the container bridge helper instead of accepting generic bridge-shaped strings.
- Agent tray actions no longer stamp Devin as the acting agent, keeping human UI intent separate from real bridge evidence.
- Agent/Devin browser bridge parsing now ignores `CHAT_RESPONSE` packets without explicit bridge-provided agent identity instead of defaulting them to Devin.
- Meeting recording uploads now require explicit speaker-channel metadata before separate transcription audio can produce attributed transcript evidence; missing metadata stays summary-only instead of defaulting channel 0/1 to host/guest.
- Agent/Devin room context summaries now include compact source refs for each session event, preserving candidate node ids, session refs, captured timestamps, and stable event ids inside the real Devin prompt context.
- Code-server save/delete observations from the real Agent/Devin bridge now publish into a source-validated room activity log for replayable context-graph projection instead of existing only in one browser's direct session-event queue.
- Agent/Devin user prompts, bridge status, and bridge replies now publish into a source-validated room activity log for replayable context-graph projection instead of existing only in one browser's direct session-event queue.
- Container terminal command/output events now publish into the room Durable Object, replay into context-graph projection, and reject source-less terminal claims instead of relying only on one browser's direct session-event POST.
- Meeting transcript processing failures now append immutable assessment diagnostics with exact recording/transcription source keys and error provenance instead of living only in the mutable meeting row.
- open-source assessment room room session evidence now stores the full stable browser/bridge event packet as the immutable `meeting_session_event` source text instead of reducing source refs to display text.
- Dev-container lifecycle rows now append immutable assessment evidence for launch, ready, warning, error, stop, and expiry transitions, preserving the exact D1 session snapshot instead of relying only on browser-observed workspace state.
- Meeting transcript ingestion now mirrors each canonical transcript source span into immutable assessment evidence, preserving speaker attribution, recording keys, source span ids, exact text, and hashes without creating source-less evaluation claims.
- Meeting-room session events, including Agent/Devin interactions, now append exact-source immutable `DEV_CONTAINER_REPO_TASK` assessment evidence events alongside candidate/context projections.
- Agent/Devin bridge readiness now marks a real container agent ready after it accepts the source-backed room-context primer, so quiet Devin CLI starts do not leave Agent chat permanently disabled, and raw chat bridge packets now include explicit `agent_stdout` provenance.
- Agent/Devin bridge status and browser agent evidence now require explicit bridge-provided agent identity instead of defaulting source-less status/messages to `devin`.
- Browser-observed Agent/Devin agent messages now require explicit bridge source metadata before becoming agent chat/status evidence instead of defaulting source-less messages to bridge diagnostics.
- Browser-observed Devin/code-server file changes now require explicit `code_server_workspace` bridge source metadata before becoming save/delete evidence instead of defaulting missing source fields.
- Source-less assistant notices are now rejected by the room Durable Object and skipped during replay instead of gaining Durable Object fallback provenance.
- Workspace/dev-container state without browser observer evidence is now rejected by the room Durable Object and skipped during replay instead of gaining Durable Object fallback provenance.
- Agent UI and bridge suggestion evidence now carries stable action ids and capture timestamps across tray, prompt, browser-executed, and persisted bridge suggestion paths.
- Agent/Devin agent reply evidence now carries stable CHAT_RESPONSE ids, capture timestamps, response fingerprints, and lengths across browser fallback and persisted bridge paths.
- Agent/Devin agent status evidence now carries stable bridge status ids and capture timestamps across browser-observed states and persisted container diagnostics.
- Workspace-state evidence now carries actor-bound observer ids and capture timestamps through Durable Object replay, normalizes room replay ids, and preserves that source context before becoming meeting-session context.
- Code-server iframe open evidence now carries actor-bound open ids and capture timestamps before entering meeting-session context.
- Container terminal command/output evidence now carries actor-bound capture ids and timestamps so repeated same-command interactions remain distinct source events.
- Assessment file-system events without browser source evidence are now rejected by the room Durable Object and skipped during replay instead of becoming source-less `file_change` graph nodes.
- Assessment panel/navigation/data/state events without browser source evidence are now rejected by the room Durable Object and skipped during replay instead of gaining Durable Object fallback provenance.
- Room surface changes without browser-toggle source evidence are now rejected by the room Durable Object and skipped during replay instead of gaining `room_surface_durable_object` fallback provenance.
- Workers AI model routing now remaps deprecated Llama 3.1 8B variants before inference so repo/challenge discovery does not fail on stale environment overrides.
- Historical assessment browser navigations carried stable navigation ids, capture timestamps, and URL fingerprints through room state, Durable Object replay, and session-event validation.
- Assessment panel lifecycle/state events now preserve stable event ids and capture timestamps through the client connection, Durable Object replay, and session-event validation.
- Summary-only room transcripts now persist their person-context mode into living-context metadata and cannot create candidate source attributions, assertions, or signals.
- Agent/Devin agent reply evidence now requires real `CHAT_RESPONSE` provenance, persisted bridge metadata or explicit browser fallback metadata, and rejects bridge-shaped replies without those source facts.
- Agent/Devin agent status evidence now requires bridge provenance, observed timestamps, and either browser WebSocket context or persisted bridge diagnostics before entering the meeting-session graph.
- Participant join/leave evidence now requires meeting-room lifecycle route provenance with observed timestamps and matching host/guest roles before entering the meeting-session graph.
- Historical assistant prompt evidence preserved browser trigger, room/workspace context, and explicit no-agent-response provenance through Durable Object replay, while rejecting source-less direct prompt claims.
- Workspace-state evidence now separates browser observer provenance from launch/refresh/error lifecycle source, preserves that metadata through Durable Object replay, and rejects source-less direct workspace-state claims.
- Code-server editor-open evidence now requires browser iframe load provenance, workspace session context, and an explicit no-proxy-URL persistence marker before entering the meeting-session graph.
- Recording start/stop evidence now requires host browser MediaRecorder provenance, lifecycle kind, speaker-channel metadata, and upload source facts before entering the meeting-session graph.
- Agent/Devin user prompts now require source-backed browser chat evidence with bridge delivery, prompt ids, fingerprints, lengths, and workspace context before entering the meeting-session graph.
- Agent control evidence now rejects source-less UI-control claims before entering the meeting-session graph.
- Open-source assessment chat browser submissions now use source-backed chat evidence with stable message ids, client ids, delivery status, message timing, surface, and room phase before entering the meeting-session graph.
- open-source assessment room terminal command/output evidence now requires browser terminal WebSocket provenance, deterministic command/output ids, fingerprints, lengths, and workspace context before entering the meeting-session graph.
- Assessment panel open/close and state updates now require source-backed lifecycle/state metadata before entering meeting-session evidence, and already-open tool clicks restore focus through source-backed room state.
- Standalone code-review assessment routing now ignores room lifecycle telemetry when deciding whether candidate decomposition evidence exists, sends telemetry-only candidates back to CV intake, and replaces claimed invite tokens before emailing assessment links again.
- Agent/Devin agent replies now require real bridge `CHAT_RESPONSE` source metadata before becoming `ai_chat_agent` evidence; source-less browser claims are rejected as invalid session events.
- Video-room clients now rely on the source-backed lifecycle route for participant join/leave evidence and stop retrying permanent session-event validation failures forever.
- Code-server save/delete evidence now requires FILE_CHANGED bridge provenance, content hash, size, observation time, and either direct container persistence or browser-fallback room/workspace context before entering the graph.
- Room surface changes now carry browser-toggle provenance, stable surface-change ids, timestamps, previous/next surfaces, and Durable Object replay markers across live capture and replayed projections.
- Assessment presence evidence now includes actor-bound sample ids, browser input provenance, timestamps, sampling thresholds, and previous-position deltas before the API accepts it.
- Video room microphone/camera evidence now includes actor-bound event ids, browser control provenance, capture timestamps, and previous/next state before the API accepts it.
- Room Chat now exposes an assessment assistant launcher for the existing real Agent/Devin panel without rerouting human chat or fabricating assistant replies.
- Durable room-chat replay now preserves accepted delivery status and browser-source provenance before projecting chat into meeting-session evidence.
- Video room microphone/camera toggles now persist as validated source-backed `media_control` evidence with surface and room phase metadata.
- Code-server workspace creates/modifies now persist as source-backed `code_editor_save` evidence with bridge source metadata and content hashes, while deletes remain `file_change` evidence.
- Meeting-session event replay now keys evidence on stable event properties, preserving distinct repeated Assessment interactions while keeping Durable Object replays idempotent.
- Session-event route coverage now proves browser-submitted client event ids preserve distinct repeated same-second Assessment interactions while retrying the same client event remains idempotent.
- Browser-submitted meeting-session evidence now includes stable client event ids and capture times, so repeated same-second Assessment interactions remain distinct while retries keep the same source identity.
- The VideoRoom Durable Object now accepts host and guest room activity through the same assessment path instead of rejecting guest updates.
- Agent/Devin chat now opens from the assessment assistant control even before the workspace is ready, clearly distinguishes real Devin availability from Room Chat, and lets users restore Agent after dismissing the prompt.
- The video-room package now owns its Agent/Assessment component test harness, preventing duplicate React renderers from invalidating the real-agent chat tests.
- Opening or closing the assessment agent now emits source-backed human UI lifecycle evidence without claiming a Devin response.
- Video-room session evidence now requeues non-OK API writes and drains queued events with Beacon/keepalive on page unload so short-lived Assessment interactions are less likely to disappear before persistence.
- The session-events API now accepts Beacon-style `text/plain` JSON and returns non-OK when persistence fails, letting the room client retry instead of dropping uncaptured evidence.
- Dev-container workspace launches now pass the Worker `DEVIN_API_KEY` secret into the container as server-side init data for the real Agent/Devin bridge without exposing the key in candidate-facing room responses.
- The Agent/Devin bridge now persists an `auth_required` agent diagnostic as soon as it observes missing real Devin credentials, instead of waiting for a candidate chat attempt before creating source-backed evidence.
- The Agent/Devin bridge now reports a real `starting` state, waits for observed non-auth Devin output before enabling chat, times out missing readiness as a source-backed diagnostic, and classifies Devin auth/login output as source-backed auth diagnostics instead of fake agent replies.
- Matched-repo dev workspaces now surface an explicit `missing_reviewable_task` diagnostic when no PR/task is assigned, and room layout evidence preserves that setup gap instead of treating a repo-only launch as a completed assessment challenge.
- Scheduling now returns and displays a rebuildable assessment setup projection for workspace-backed invites, distinguishing concrete PR tasks from missing reviewable tasks and contact-first invites waiting for source-backed candidate evidence.
- Contact-first invite living-context artifacts now preserve assessment setup diagnostics in exact source text and qualifiers, so missing candidate evidence or missing PR tasks remain source-backed instead of UI-only state.
- Assessment Browser now detects common sites that block iframe embedding, including Google, and shows an external-open fallback instead of a blank white page.

### Added — open-source assessment room repo-task assessment contract

- Added the proposed source-backed repo-task assessment contract for `DEV_CONTAINER_REPO_TASK` and `OPEN_SOURCE_BUG_FIX`, including candidate evidence packets, repo task packets, match diagnostics, AI usage evidence, and final evaluation output types.
- Documented the open-source assessment room repo-task matching plan, preserving the Evidence Hypergraph requirements that no positive match or evaluation claim can exist without source refs.
- Tightened the repo-task final assessment output into evaluated vs diagnostic states so successful evaluations require source-backed submission/evaluation evidence and non-success states require explicit diagnostics.
- Added a final repo-task submission bundle route that records candidate plans, diagrams, messages, terminal output, test runs, code diffs, AI interactions, tool usage, transcript spans, and final explanation as immutable source-backed assessment events before marking the session `FINAL_SUBMITTED`.
- Added `OPEN_SOURCE_BUG_FIX` as a workspace-backed assessment interview mode for scheduling, invite creation, dev-container launch, and candidate assessment routing.
- Added the canonical assessment-layer persistence spine with assessment sessions, immutable source-backed evidence events, state transitions, evaluation reports, diagnostics, and a repo-task compatibility projection for later `OPEN_SOURCE_BUG_FIX`/dev-container assessment routes.
- Added the repo-task assessment session facade and focused API route tests for creating sessions, appending exact-source evidence events, transitioning state, rejecting unsupported positive claims, recording AI-unavailable diagnostics, and projecting assessment evidence into context records.
- Assessment evaluation reports now reject positive claims whose cited source refs were not previously captured as immutable evidence events in the same assessment session.
- Completed scored CODE_REVIEW sessions now write exact-source transcript and score-report events plus an evaluated assessment report into the assessment evidence spine with idempotent state transitions.
- open-source assessment room room lifecycle now replays Durable Object layout/chat/file activity into source-backed meeting-session evidence when the host ends the room, instead of waiting for a later context-graph read.
- open-source assessment room room chat now persists as first-class `chat_message` evidence instead of being mislabeled as Agent/Devin `ai_chat_user` input.
- open-source assessment room room chat now reconciles optimistic local sends with Durable Object ACK/rejection messages, so browser evidence marks client submissions as pending while the shared room log remains the authoritative accepted-chat source.
- open-source assessment room shared file deletes now enrich the Durable Object activity log with the deleted file snapshot when available, letting replay evidence preserve deleted file name, kind, content hash, and bounded preview.
- open-source assessment room room lifecycle now captures accepted guest join/leave and recording start/stop events as source-backed meeting-session evidence, without fabricating a recording stop when no recording was active.
- open-source assessment room recording transcripts now persist per-segment speaker-channel metadata and attribution-source metadata, so host/guest transcript evidence can explain the stream/channel mapping used for speaker roles.
- open-source assessment room browser recording lifecycle events now include the real speaker-channel map, ICE provider, media MIME types, and captured byte counts, and host-end auto-stop uses the same source-backed event path as manual stop.
- The video-room dev smoke now verifies the intended standard-call landing state before launching the open-source assessment room and confirming that both participants can enter the assessment workflow.
- open-source assessment room terminal panels now capture completed container commands and bounded terminal output chunks as source-backed meeting-session evidence with workspace/session metadata.
- open-source assessment room terminal evidence now links bounded output chunks back to the completed command being run with terminal session ids, command/output sequence ids, and deterministic text fingerprints.
- open-source assessment room now captures a deduplicated `code_editor_open` evidence event when the VS Code/code-server workspace iframe actually loads, without persisting room-token proxy URLs.
- open-source assessment room workspace state events now preserve source-backed dev-container diagnostics, including session id, status, repo context, TTL, and error message, without persisting room-token proxy paths.
- Agent/Devin bridge status transitions now persist as source-backed meeting-session evidence, including real auth-required/disconnected states instead of simulated agent availability.
- Agent/Devin chat evidence now distinguishes real Devin stdout from bridge diagnostics and file-watcher observations, so auth-required and container-observed events are not recorded as fabricated Devin replies.
- Agent/Devin bridge outputs now preserve their origin, bridge event type, agent name, and stdout source in evidence, distinguishing real Devin output from local prompt-button nudges.
- Agent/Devin process diagnostics now broadcast bounded, redacted stderr, context-primer failures, process exits, and startup errors into `ai_agent_status` evidence with diagnostic source, observed time, exit code, and signal metadata.
- Agent/Devin prompt handoffs now persist bridge diagnostics for real context-primer and chat-prompt delivery into Devin stdin, including delivery status, context status, and redacted fingerprints/lengths without storing raw prompt text.
- Agent/Devin bridge diagnostics, prompt handoffs, and real Devin stdout now post token-scoped `session-events` directly from the dev container before broadcasting to browsers, with browser fallback only when bridge persistence fails.
- Agent/Devin bridge responses now persist directly from the bridge as source-backed chat/status evidence, while browser workspace evidence remains separate.
- Code-server workspace file create/modify/delete events are now observed by the container bridge and captured as source-backed `file_change` meeting-session evidence with path, hash, size, and bounded text preview when available.
- Dev containers can now post token-scoped room `session-events` directly in dev without the browser Basic Auth proxy, so code-server workspace evidence persists through the same room-token validation path as room context.

### Fixed — Calendly scheduling sync and confirmations

- Calendly scheduling links now load event types from both user-owned and organization-owned Calendly event types, normalize them for the invite modal, and fall back to the user's Calendly scheduling page when no discrete event type is returned.
- Calendly booking webhooks now import unmatched scheduled bookings, update existing invites idempotently, and link each booking 1:1 to a Pipe meeting/room using the Calendly scheduled event URI.
- Scheduling list/detail views now expose the Calendly provider event reference and linked Pipe meeting id so accepted scheduled bookings are inspectable from the recruiter UI.
- Candidate scheduling emails now use the Pipe room link for confirmed Calendly bookings and render the PIPE logo from a public HTTPS API asset instead of embedded data images.
- The legacy scheduling sync endpoint no longer polls Calendly's paginated `scheduled_events` API; provider webhooks are the source of truth.

### Fixed — Standalone code review repo matching intake

- Candidate CV decomposition now defaults stale Workers AI config to the current Gemma model instead of deprecated Llama 3.1 8B, preventing repo matching from failing into a candidate-facing needs-attention state.
- Assessment emails now ignore stale scheduling URLs: CODE_REVIEW delivers fresh `/assess/:token` links, while DEV_CONTAINER_CHALLENGE and OPEN_SOURCE_BUG_FIX deliver controlled workspace room links.
- Resume-derived review evidence now preserves diverse source-backed repo-matching terms and the deterministic matcher now prefers specific source concepts over generic language overlap.
- Standalone code-review matching now attempts repo selection as soon as source-backed text-intake evidence exists, even if richer enrichment is still pending, and no longer exposes a fake estimated matching timer.
- Plain-text candidate intake now runs through the same CV parsing/decomposition contract as uploaded resumes before starting ingestion, so standalone code-review invites produce source-backed candidate evidence for deterministic repo matching.
- Resume decomposition now persists candidate nodes and living-context evidence before optional embedding, preventing Workers AI/embedding outages from leaving candidates stuck on `WAITING_FOR_MATCH` with a resume key but no scoreable graph evidence.
- Parser-only resume fallback now creates source-backed semantic terms for experience/project evidence, and creates a bounded text-intake fallback node when no structured sections are available.
- Plain-text intake decomposition now normalizes partial LLM JSON before deriving parsed CV fields, preventing missing arrays from crashing ingestion and sending candidates back into the matching loop.
- Standalone CODE_REVIEW creation now accepts recruiter-supplied repo/PR overrides only as a complete validated pair, and persists them on the scheduled interview when the invite should skip automatic repo selection.
- The recruiter invite modal now treats CODE_REVIEW as an async assessment invite, hides video-room feature toggles for that path, and blocks incomplete manual repo/PR overrides before submission.
- Interview detail pages now render standalone CODE_REVIEW submission results, including verdict, summary, annotation count, and inline annotation comments next to repo/PR evidence, without unrelated video-room or live-workspace controls.
- The candidate CODE_REVIEW surface now uses the deployed marketing site's blue-black glass/blueprint treatment with Inter prose and monospace-only technical labels, while preserving the three-column review workflow.
- The candidate CODE_REVIEW surface now displays inspectable GitHub repository and PR links, and the standalone browser/e2e fixture now uses the verified public `cloudflare/workers-sdk#14435` review packet instead of synthetic `pipe/e2e-*` repo identities.
- Standalone CODE_REVIEW challenges now return a candidate-safe match proof with quality-gate checks, source counts, and sanitized role/person/repo evidence; the candidate UI renders the match proof and recruiter Context continues to show the full evidence bridge and submitted review.
- Standalone CODE_REVIEW repo matching now persists and returns a candidate-safe deterministic validator-agent decision, including source-backed gate checks for candidate evidence, role alignment, repo spans, provenance, stretch bounds, and eligible PR selection.
- Candidate assessment session caching is now scoped to the invite token in the URL, preventing stale browser tabs from rendering one candidate's challenge while showing another invite URL.
- Multi-turn CODE_REVIEW round submissions now send the Worker `summary`/`newAnnotations` payload contract and provide a default first-round summary when candidates submit inline comments without separate prose.
- The CODE_REVIEW assess-link browser smoke now selects a substantive diff line and verifies the rendered annotation badge before submitting the AI-developer pushback round.
- Completed multi-turn CODE_REVIEW sessions can now advance idempotently after the review-session endpoint has already written the submission row, preventing candidates from getting stuck on a duplicate-submission loop.
- Multi-turn CODE_REVIEW completion rows now expose normalized verdict, summary, and flattened candidate annotations alongside the full transcript, so recruiter review pages do not lose v2 review details.
- Candidate CODE_REVIEW diffs now render through the real `@pierre/diffs` `PatchDiff` component, with AI author pushback/change/comment threads displayed inline under the candidate's source comment.
- Standalone source-backed CODE_REVIEW challenges now materialize a hidden multi-turn backing challenge/assessment so candidates must defend review comments against the AI developer before final submission.
- The CODE_REVIEW implementer agent now returns an explicit `AI_DEVELOPER_UNAVAILABLE` diagnostic when no real author agent can respond, preventing simulated PR-author replies from entering candidate transcripts.
- Recruiter candidate profiles now resolve standalone CODE_REVIEW `reviewSessionId` submissions back to the stored review transcript so verdict, summary, and annotations remain visible after the AI-developer defense flow.
- Source-backed CODE_REVIEW packets now convert persisted `added`/`deleted` diff rows and source-backed hunk headers into valid unified patches before rendering, preventing real Pierre diff bodies from appearing blank.
- Source-backed CODE_REVIEW packets now emit valid unified hunk headers from the Worker, and the candidate browser regression fails on Pierre diff parser errors for real review packets.
- The recruiter CODE_REVIEW stage tab now describes the async assessment, source-backed hypergraph match gate, validator agent, and AI developer pushback loop instead of presenting the stage as a live video room.
- Manual CODE_REVIEW repo/PR overrides now return a candidate-safe validator-agent justification that distinguishes source-backed recruiter selection from automatic CV-to-PR matching.
- CODE_REVIEW match explanations now include an assessment-quality rubric for skill/stack overlap, role/JD overlap, PR reviewability, match specificity, source coverage, and contrast separation, with the candidate match proof UI rendering those reasons.
- Automatic CODE_REVIEW match quality now downgrades measured near-ties from `STRONG` to `USABLE`, and matcher tests cover opposing candidate profiles selecting different review packets instead of collapsing onto one repo.
- Candidate-safe CODE_REVIEW quality gates now require `STRONG` or `USABLE` assessment-quality verdicts before marking an automatic match as passed, so source-backed provenance alone cannot bless a weak assessment.
- Candidate-safe CODE_REVIEW quality gates now require explicit validator-agent approval and an assessment-quality verdict before marking an automatic match as passed, preventing partial or older match runs from being shown as fully validated.
- Added a compact local CODE_REVIEW matching proof script that audits every local D1 database, distinguishes fixture packets from real overlay-ready packets, and reports the next action needed before claiming production repo-matching readiness.
- Multi-turn standalone CODE_REVIEW completion now immediately reconciles the scheduled interview row with the source-backed transcript submission, so recruiters see the completed async review even if the candidate stops on the Review Submitted screen.
- Existing terminal multi-turn CODE_REVIEW sessions now rehydrate as completed instead of showing an interactive conversation that fails with `Session is not active`, and reloads preserve stored review rounds/inline annotations.
- Added a local Base UI matching proof seed plus compact matcher output for proving automatic candidate/role evidence selects a real non-fixture `mui/base-ui#973` review packet with validator and assessment-quality approval.
- The local Base UI matching proof seed now resets the reusable assess token and targets the local D1 database that actually contains source-backed review packets, preventing browser smokes from opening a stale claimed invite or reseeding the wrong SQLite file.
- Interview detail pages now surface CODE_REVIEW match quality and the role/person/repo evidence bridge from the stored match run, so recruiters can inspect why a PR was selected alongside the candidate's review.
- Completed multi-turn CODE_REVIEW sessions now persist a compact `code_review_judge_examples` artifact for judge-prompt regression, feedback-loop calibration, human labelling, and future cross-model evaluation.
- Review-packet profile backfills now refresh stale row `source_hash` values whenever packet `contentHash` changes, preventing real source-backed packets from being excluded from automatic repo matching by provenance checks.
- Standalone CODE_REVIEW now waits for source-backed candidate evidence before automatic repo matching and refreshes weak cached automatic PR selections instead of serving near-tie matches as final challenges.
- The local CODE_REVIEW full-submit smoke now verifies assessment-layer persistence, including immutable evidence events, source refs, evaluation reports, claims, and claim source refs for the completed review session.
- CODE_REVIEW author pushback now recovers valid structured model responses wrapped in objects, returned as a single object, or containing raw newlines inside string fields, while still failing closed when no real author response is present.
- Recruiter CODE_REVIEW score overrides now label the corresponding `code_review_judge_examples` row with the human score report, giving the judge/feedback loop replayable calibration targets from human corrections.
- Recruiter review-session APIs now expose an owner-scoped CODE_REVIEW judge-example queue, giving the judge/feedback loop a deterministic replay surface for ready and labelled calibration examples.
- CODE_REVIEW author pushback and automated scoring now honor the configured Kimi provider before falling back to Workers AI, preventing local/prod scorer runs from silently using the wrong LLM path.
- CODE_REVIEW author pushback now falls back from an unavailable configured Kimi provider to real Workers AI before returning `AI_DEVELOPER_UNAVAILABLE`, preserving the no-simulated-author rule while avoiding bad-key dead ends.
- CODE_REVIEW author pushback now accepts real-provider responses that wrap the required JSON array in prose or common Workers AI response objects, while still rejecting non-JSON simulated replies.
- CODE_REVIEW author pushback now retries a secondary Workers AI model when the primary Workers AI response is empty or unparsable, reducing flaky `AI_DEVELOPER_UNAVAILABLE` outcomes without fabricating author behavior.
- Candidate-facing CODE_REVIEW match proof now renders readable quality-gate labels instead of raw internal check IDs while keeping the audit IDs in the server payload.
- Candidate-facing CODE_REVIEW match proof now includes candidate-safe evidence hyperedges that connect person evidence, role context, and repo source spans for the selected PR.
- Recruiter interview detail pages now render CODE_REVIEW evidence hyperedges from stored match runs, so reviewers can inspect the person-role-repo justification behind the selected PR.
- Recruiter scheduling detail API tests now lock in source-backed CODE_REVIEW match hyperedges from stored match runs, preventing the person-role-repo justification from disappearing before results rendering.
- CODE_REVIEW match hyperedges now require person evidence, role/JD source, and repo challenge evidence before being labeled as candidate-role-repo alignment, so pairwise evidence is not overstated as a hypergraph match.
- CODE_REVIEW transcript ingestion now links completed review evidence to the selected challenge packet, candidate challenge assignment, latest match run, and final verdict inside the persisted context-record hyperedge.
- CODE_REVIEW score-report ingestion now links final scoring evidence to the selected challenge packet, candidate challenge assignment, and match run, so recruiter score/gap records remain traceable to the repo/PR recommendation.
- Living-context backfills now have a regression proving completed CODE_REVIEW sessions rebuild selected challenge packet, match-run, assignment, and final-verdict provenance instead of losing the assessment evidence chain.
- Living-context backfills now have an idempotency regression proving repeated completed CODE_REVIEW rebuilds do not duplicate artifact versions, source spans, context records, source refs, or entities.
- Recruiter CODE_REVIEW match detail now downgrades stale role-backed validator proof to `NEEDS_REVIEW` when the stored assessment lacks measured positive contrast separation, preserving the selected PR without overstating match quality.
- CODE_REVIEW invite delivery now proves the candidate-facing delivered URL is an `/assess/:token` link and labels no-scheduler emails as assessment invitations instead of video-call invitations.
- Standalone CODE_REVIEW completion tests now prove the scheduled interview row stores the final verdict, summary, annotations, transcript, and review session id that recruiter detail pages render after submission.
- Automatic CODE_REVIEW match proof now requires measured positive contrast separation before marking a candidate-safe match as `PASSED`, and the local verifier no longer claims repo-matching readiness with only one real overlay-ready packet.
- Role-backed CODE_REVIEW RPC match proof now also requires measured positive contrast separation before returning a candidate-safe `PASSED` gate; the app-dev smoke defaults auto-match contrast checks on and can explicitly assert intentional `NEEDS_REVIEW` proof states in browser diagnostics.
- Local CODE_REVIEW matching proof now seeds/backfills a second real Base UI packet (`mui/base-ui#5110`) and uses a broader React trigger role, proving automatic matching selects `mui/base-ui#973` over a nearby real comparator with measured contrast separation.
- The standalone CODE_REVIEW browser regression now seeds a second reviewable comparator PR before opening the candidate page, so the E2E must render automatic person-role-repo proof with measured contrast instead of silently accepting a manual override fallback.
- Added an opt-in unauthenticated CODE_REVIEW assess-link smoke that can run against app-dev/prod with a disposable token and proves real GitHub repo/PR links, match proof, hypergraph evidence, Pierre commentable diff lines, and no video-room fallback.
- Added a one-command app-dev CODE_REVIEW invite-to-assess smoke that creates a disposable scheduling invite, asserts the delivered URL is `/assess/:token`, submits source-backed intake evidence, polls for a ready CODE_REVIEW challenge, and runs the browser smoke with the claimed candidate session. The smoke defaults to the source-backed `mui/base-ui#973` manual override and exposes `CODE_REVIEW_SMOKE_AUTO_MATCH=1` for stricter auto-match environments.
- Candidate intake now accepts pasted resume/profile text as a first-class fallback to PDF/DOCX upload, so browser-only CODE_REVIEW assessments can progress without a file picker.
- Candidate assess links that have already been claimed now render the explicit "Link Already Used" state instead of a generic connection error.
- Roleless CODE_REVIEW auto-match now preserves exact CV review-evidence phrases such as component identifiers, interaction thresholds, and test-runner references, then allows a validator-approved source-backed match once candidate-to-repo evidence clears the standalone assessment threshold.
- Candidate and recruiter CODE_REVIEW match proof panels now label roleless evidence bridges as `CANDIDATE_REPO` instead of implying role context exists, preserving the hypergraph distinction between candidate-repo and person-role-repo matches.
- The CODE_REVIEW assess-link smoke now loads local dotenv files and passes dev basic-auth credentials through Playwright for remote app-dev validation.
- The CODE_REVIEW assess-link smoke now splits app-dev recruiter setup from api-dev candidate RPC calls and reports sanitized challenge context when deployed validation fails.
- Roleless CODE_REVIEW automatic matching now accepts exact, source-backed candidate symbol evidence against a single production-ready repo packet as a `USABLE` validator-approved match, preventing strong Base UI matches from looping in `WAITING_FOR_MATCH` just because role context and contrast separation are unavailable.
- App-dev CODE_REVIEW smoke validation now passes for both manual `mui/base-ui#973` override and strict auto-match from pasted candidate evidence, including source-backed match proof, validator, quality gate, Pierre diff rendering, and no video-room fallback.
- The app-dev CODE_REVIEW smoke now has an opt-in full-submission mode that initializes the AI developer defense session, submits a real inline annotation/verdict, and verifies recruiter interview detail plus candidate-profile result visibility.
- Candidate CODE_REVIEW match proof now starts with a readable `WHY_THIS_PR` summary that shows candidate evidence, optional role context, repo challenge evidence, match mode, and roleless gaps before the deeper source-backed proof.
- Live CODE_REVIEW review-packet seeding now resolves sample PR rows through crawler-owned repository IDs and includes a smaller real `mui/base-ui#5095` comparator input for app-dev contrast-separation backfill.
- CODE_REVIEW auto-match now expands source-backed compound CV terms into atomic recall keys such as `popover`, `trigger`, `click`, and `typescript`, so real concept-near PR comparators can be recalled without relaxing provenance gates.
- The app-dev CODE_REVIEW auto-match smoke now fails when contrast separation is unmeasured or too weak, preventing a single recalled packet from masquerading as a high-quality repo match.
- Recruiter CODE_REVIEW evidence bridges now label roleless matches as `candidate evidence -> repo challenge` with match concepts instead of showing a misleading role-context bridge.
- Role-backed auto-built CODE_REVIEW challenges now carry multi-turn review-session config, so matched pipeline assessments initialize the AI developer pushback flow instead of stopping after the diff page.
- The app-dev CODE_REVIEW smoke now supports `CODE_REVIEW_SMOKE_ROLE_BACKED=1`, creates a simple-JD role context plus auto-built pipeline, clicks through the candidate Welcome gate, and proves the completed recruiter result has role source evidence plus a person-role-repo hyperedge.
- The app-dev full-submission CODE_REVIEW smoke now verifies the judge-example replay queue contains the completed review session with candidate comments, AI developer pushback, and improvement-loop metadata for human labelling and cross-model calibration.
- The app-dev full-submission CODE_REVIEW smoke now drives the visible candidate UI to add an inline Pierre diff comment, submit the first review round, and wait for the author response before completing recruiter and judge-example verification.
- The CODE_REVIEW full-submission smoke now explicitly replays the candidate stage-config bootstrap after matching becomes ready, so direct review-session verification creates the same assessment row as the browser flow instead of failing on `No assessment found for this stage`; transient local fetch resets are retried before failing the smoke.
- Deployed the dev API and app shell with the current CODE_REVIEW match-proof UI; the app-dev role-backed auto-match full-submission smoke now passes end-to-end, including `mui/base-ui#973`, `MATCHED`, `qualityGate: PASSED`, `ASSESSMENT_FOCUS`, browser inline Pierre comments, AI developer response, recruiter completion, and a judge replay example with human-labelling/cross-model calibration uses.
- Recruiter interview detail now returns a source-backed manual CODE_REVIEW match proof when a recruiter-selected repo/PR has a production-ready review packet but no automatic `match_runs` row, so manual overrides show validator and assessment-quality proof instead of a missing `codeReviewMatch`.
- The CODE_REVIEW app-dev full-submit smoke now passes for manual override, roleless auto-match with measured contrast, and role-backed auto-match, and the smoke harness requires manual recruiter detail to expose `MATCHED`, validator `PASSED`, and `USABLE` assessment quality proof.
- Applied the dev D1 `0100_code_review_judge_examples.sql` migration to `pipe-db-test`, enabling app-dev to persist and serve CODE_REVIEW judge replay examples.
- Recruiter interview detail pages now render CODE_REVIEW AI developer defense threads from stored review transcripts, pairing candidate annotations and follow-up defenses with AI developer pushback/change/comment responses; the full-submit smoke now fails if recruiter detail loses transcript rounds, reviewer comments, or AI developer responses.
- Added a deterministic CODE_REVIEW judge-example verifier that reports READY/LABELLED counts, replay-ready examples, calibration-ready labelled examples, missing prompt/provenance fields, and failure-mode labels for the judge/feedback improvement loop.
- Recruiter CODE_REVIEW score overrides can now attach structured judge calibration metadata, including reviewer feedback and judge failure modes, so labelled examples carry the reason a human corrected the automated score.
- Candidate CODE_REVIEW match proof now leads with a compact `MATCH_REASON` that explains why the PR was selected in human terms, shows matched source-topic chips, and distinguishes recruiter manual overrides from inferred CV fit before the deeper hypergraph proof.
- Source-backed CODE_REVIEW packets now carry candidate-safe `ASSESSMENT_FIT` metadata with difficulty band, expected seniority, target review time, and source-derived sizing facts; the candidate assessment and AI-developer review-session UI both render it, and the browser smoke asserts it.
- The local CODE_REVIEW matching verifier now requires at least two real overlay-ready packets with persisted assessment-fit review profiles before reporting `ready`, distinguishing raw contrast readiness from calibrated assessment readiness.
- Added `review-packets:repair-profiles`, a local D1 repair script that dry-runs by default and can persist `reviewProfile` metadata plus refreshed packet content hashes for legacy `review_challenge_packets` rows; the selected local D1 corpus now reports calibrated contrast readiness for real `mui/base-ui#973` and `#5110` packets.
- Recruiter interview detail now carries and renders the same candidate-safe CODE_REVIEW `ASSESSMENT_FIT` profile from ranked match results or legacy review packet JSON, so recruiters can inspect difficulty, seniority, expected time, and sizing facts next to match evidence.
- Deployed the current dev API/app shell and re-ran the role-backed app-dev CODE_REVIEW full-submit smoke, proving automatic `mui/base-ui#973` matching, readable match reason, `ASSESSMENT_FIT`, validator approval, hypergraph evidence, Pierre inline comments, AI developer pushback, recruiter result visibility, and judge replay example creation.
- Re-ran the roleless app-dev CODE_REVIEW full-submit auto-match smoke against the same deployment, proving measured positive contrast separation against a comparable packet plus full candidate submission, AI pushback, recruiter result, and judge replay visibility.
- Re-ran the manual app-dev CODE_REVIEW full-submit smoke and adjusted the browser assertion to require the candidate-facing "recruiter selected" source-backed explanation instead of internal "manual override" jargon, while still proving no CV-fit claim, AI pushback, recruiter result visibility, and judge replay creation.

### Fixed — API route ordering and RPC auth bypass

- Reordered Hono route mounts in `workers/api/src/index.ts` so `meetingRooms` is mounted before `devContainerSessions`, preventing the catch-all `authMiddleware` from intercepting meeting-room requests with 401 errors.
- Added `/rpc/` path bypass in the global dev proxy secret middleware so RPC routes using candidate JWT auth are not blocked.
- Restored `containers` config in `workers/api/wrangler.jsonc` dev environment for `DevContainerDO`.

### Added — Standalone dev container challenge RPC support

- Added `getPendingDevContainerChallenge` lookup in RPC routes for standalone `DEV_CONTAINER_CHALLENGE` interviews.
- Added `StandaloneDevContainerRow` interface and pending challenge query for candidate-facing dev container flows.

### Added — Real Source-Backed Repo Challenge Packet Backfill (HAS-83)

- Added `backfillReviewChallengePackets` pipeline that selects eligible merged PRs from the crawler D1 catalog (`repo_sample_prs` joined with `qualified_repos`), fetches PR refs, diff, and changed-file source from GitHub, normalizes them into a deterministic `NormalizedPullRequestInput`, builds a challenge packet through the `repoSemanticGraph` pipeline, and persists the full graph through `persistReviewChallengeGraph`.
- Backfill is idempotent: PRs with an already-persisted packet (`repo_id` + `pr_number` + `packet_version`) are skipped unless `force` is set; forced re-persist produces byte-identical rows because packet identity and content hashes are deterministic.
- Added `selectEligibleCrawlerPullRequests` enforcing structural eligibility (merged, modifies tests, not archived/disqualified, changed-file/line thresholds) in SQL and language eligibility (challenge-packet-allowed languages only) post-fetch.
- Added `countOverlayReadyPackets` readiness gate reporting the number of `production_ready=1` packets in D1; the backfill succeeds when at least one real overlay-ready packet exists after the run.
- Added focused `repoSemanticGraph/backfill` tests proving a real source-backed overlay-ready packet is persisted with exact source spans, structural facts (`changed_symbol`, `imports`, `calls`, `contains`), parser-supported symbols, repo source refs (GitHub head-content external references), a `repo_challenge_packet` context record with linked source refs, open concept links, and the derived semantic graph (episodes, facets, assertions, signals).
- Added idempotency and force-rebuild regressions proving second-run skip, byte-identical state preservation, and deterministic forced re-persist.

### Changed — Harden source-backed repo discovery and matching (HAS-86)

- Removed the `jaccardText` text-overlap fallback in `semanticSimilarity` so the `semanticNarrative` scoring dimension contributes zero when embedding evidence is absent instead of fabricating a heuristic text-overlap score.
- Direct source-backed concept matches are no longer penalized for missing embeddings; absent embedding similarity remains recorded as zero but is excluded from the pair-score denominator.
- Removed fabricated `roleRequirement: true` and `highWeightRoleRequirement: true` defaults in `materializeChallengePacketForMatching` when no role concepts are provided; demands are now only marked as role requirements when backed by source-evidenced role concept overlap.
- Made role discovery optional in `alignCandidateToChallenge`: `ROLE_RELEVANCE_BELOW_THRESHOLD` and `NO_HIGH_WEIGHT_ROLE_REQUIREMENT` rejection reasons are only applied when at least one demand carries a role requirement, so challenges remain eligible without role context.
- Removed the hard-coded `MID` seniority default in `mapSeniorityToDifficulty`; conversion now fails closed when a repo has no source-backed seniority band instead of fabricating a difficulty level.
- Added tests proving embedding-only match decisions are prevented, semantic similarity is not fabricated from text overlap, role discovery is optional, fabricated role requirement defaults are gone, non-role demands are not marked as high-weight role requirements, and rejected packets always include explicit reasons.

### Added — Expert-Labelled Evaluation and Rollout Gate for Deterministic Matching (HAS-88)

- Added staged rollout gate tests covering shadow, canary, and production stages with strictly increasing thresholds for packet coverage, pair coverage, comparison rerun coverage, expert labels, byte-identical determinism, guardrail violations, and provenance completeness.
- Added `--stage` CLI flag to `evaluateMatching.ts` so the readiness gate can enforce shadow, canary, or production stage thresholds; the readiness gate is now fully stage-aware (shadow relaxes all coverage and quality checks).
- Added full E2E evaluation scenario: roleless person + simple JD + real repo packet (repo/PR/commit) + explained candidate-to-PR match with alignment source references linking candidate evidence, JD text, and PR diff content, plus independent comparison rerun for byte-identical determinism proof.
- Fixed `persistedResultFixture` in CLI tests to include packet coverage fields (`expectedPacketCount`, `packetCoverage`, `pairCoverage`, `comparisonCoverage`, `missingPacketIds`, `packetIdentityMismatches`) so the readiness gate can evaluate persisted results correctly.
- Updated expert corpus fixture to declare expected packets matching seeded match runs so the production readiness gate passes end-to-end.

### Added — V1 Semantic Context Records (HAS-96)

- Projected source-backed `context_records` into the Neo4j living-context graph, including linked entities, source refs, and concept edges so multi-entity meaning is rebuildable from immutable source spans rather than hard-coded semantic edges.
- Extended the workspace-person concept projection to union concepts surfaced only through `context_record_concepts`, so unseen/open-data concepts survive ingestion and projection rebuild without alias lists or hard-coded semantic families.
- Added a regression proving an unseen context-record-only concept persists through idempotent replay and two projection rebuilds (delete + re-project), remaining the source-backed truth for multi-entity meaning.

### Added — Source-Backed Transcript and Interaction Semantics Ingestion (HAS-85)

- Meeting transcripts are now persisted as immutable artifact versions with content hashes, exact paragraph/source spans (char/byte/line offsets), and per-segment speaker attribution that never trusts unbound diarized labels as person identity.
- Extracted semantic assertions link back to exact transcript source spans via `assertion_source_spans`, with open predicates/narratives/qualifiers preserved verbatim from the source rather than forced into a fixed taxonomy.
- Unknown concepts surfaced in transcript assertions survive as open `term:*` concepts in the concept registry, accumulating signal evidence (noisy-or) across interactions without requiring a pre-known vocabulary.
- Interaction context remains separately reviewable: meeting interactions are stored in the `interactions` table and surfaced as their own read-model section, while context records distinguish `meeting_transcript` (raw evidence) from `meeting_transcript_assertion` (derived meaning) so reviewers can audit each independently.
- Re-processing a corrected transcript creates a new immutable version; re-running an extractor removes stale derived meaning (assertions, episodes, signal evidence) while preserving the immutable transcript artifact and source spans.
- Source-only backfill replay preserves newer semantic projections instead of deleting them, and mixed-audio Whisper fallback transcripts stay summary-only without fabricating person semantic signals.
- Added `loadInteractionLivingContext` and `loadMeetingTranscriptContext` read models that keep interaction context separately reviewable from accumulated person projections (deleting the projection outbox does not remove the per-event source-backed record).
- Added `searchTranscriptSourceSpans` and `GET /meetings/:id/transcript/search?q=` so original transcript text remains searchable and explainable — each hit returns exact source span offsets plus the assertions/context records that cite it.
- Added `GET /meetings/:id/interaction-context` to expose the shared immutable transcript artifact, exact source spans, and per-participant derived assertions/context records/signal evidence as a single reviewable view.
- Added regression proving a previously unseen concept (`phosphor lattice accumulator`) survives as an open `term:*` concept with assertions and context records linked back to exact transcript spans.
- Added invariant test that the read model returns source span exact text for every transcript-derived assertion, context record, and signal evidence entry.

### Changed — Quiet Empty Living Graph (HAS-81)

- The `LivingContextGraph` now stays quiet when a person has no source-backed evidence yet: summary metrics, search toolbar, interactions rail, accumulated-context canvas, and source inspector are hidden behind a single "No source-backed living evidence yet" state instead of rendering an empty debug dashboard.
- Source-backed standalone code-review match panels remain visible alongside the quiet empty state so reviewers still see match evidence, gaps, and packet diagnostics when present.
- Empty-state quietness is covered by BDD regressions proving empty sections collapse with and without a standalone review match.

### Added — Graph and Match Explanation UI (HAS-87)

- Added a repository packet view (`RepoPacketPanel`) to the living context graph that renders files, source spans, symbols, structural facts (quality gates), behavioral episodes (test changes + linked issue), packet assertions (demands with narratives and concept keys), and packet concepts from the persisted challenge packet.
- Extended the candidate profile API (`StandaloneReviewMatchRecord`) with a `packet` field carrying structured packet detail parsed from `packet_json`, so the recruiter UI can render the full repo packet alongside the candidate-to-PR overlay.
- Added a "Show provenance IDs" drill-down toggle on the repo packet panel that hides raw internal IDs (packet ID, span IDs, symbol IDs, demand IDs, full file paths, quality scores) by default and reveals them on demand for debugging and provenance audit.
- Made empty graph states quiet: the zero-count summary dashboard and the graph workspace no longer render when there is no living context evidence, replaced by a single quiet empty-state message.

### Added — Person-First Interview Model (HAS-80)

- Added `DEV_CONTAINER_CHALLENGE` as a first-class interview type so a recruiter can create a dev-container challenge interview for any person (contact, candidate, customer, client, or lead) without requiring a pipeline/role container.
- Dev-container challenge interviews attach a source-backed repo/PR task via `matchedRepoId` or an explicit `githubRepoUrl` + `githubPrNumber` pair; the create-interview schema rejects a `DEV_CONTAINER_CHALLENGE` request that carries no source-backed task.
- Shared the `INTERVIEW_TYPE_VALUES` constant between the scheduling and candidates routes so standalone candidate creation and the scheduling endpoint accept the same interview-type set.
- Frontend invite modals now expose the Dev-container challenge option with a dedicated mode card, and the interview detail page treats `DEV_CONTAINER_CHALLENGE` as a workspace-backed interview for dev-container session handling.
- Added scheduling route tests proving person-first `DEV_CONTAINER_CHALLENGE` interviews persist with the repo/PR task and that the source-backed-task requirement is enforced.

### Added — MVP-Simple Interview Flow with No Fabricated /video Fallback Links (HAS-89)

- Added regression tests proving roleless meetings (no pipeline, stage, or role) create `/room/:token` links end-to-end and never fabricate `/video/stageId--candidateId` fallback URLs across room preparation, guest invites, public room resolution, room reopening, and persisted `meetings.meeting_url`.
- Added regression tests proving scheduled interview detail/list endpoints return `null` (not a fabricated `/video/` link) when `meeting_url` is null, and return the canonical `/room/` URL after an invite creates one.
- Confirmed `buildInternalVideoUrl` returns `null` when no `meeting_url` exists, so the person-first MVP flow keeps the UI clean without noisy fabricated video links while video-call recordings/transcripts continue feeding the living graph.

### Added — Living Person Graph Convergence Proof (HAS-84)

- Added focused livingContext compatibility tests proving contact, applicant, candidate, customer, and client identities resolve to the same underlying workspace person when source identifiers converge.
- Added regression proving resume, interview, message, assessment, and phone-call evidence all attach to the shared person graph after identity convergence, queryable via both candidate and contact read models.
- Added regression proving interaction-level records stay separate from accumulated person context (`workspace_people.context_json` never contains interaction narratives or record types).
- Added regression proving existing `workspace_people.context_json` is preserved/merged (not overwritten) when a second identity source converges onto the same workspace person.
- Strengthened the no-fabricated-signals assertion for applicant + client convergence (zero semantic assertions, signal evidence, and concepts after identity-only convergence).

### Added — Scoped Living Context Graph CI Lane

- Added role-context graph visualization, source-backed role/person/repo evidence bridge rendering, host-manual video-room recording coverage, live review-packet backfill export, and remote E2E workflow wiring for the deployed recording-to-match proof.
- Hardened review-graph rollout with schema-only preparation, migration-plan gating, bounded GitHub/D1 fetches, and report gates that require context-ready source-backed packets.
- Live meeting workspaces now launch dev containers on the selected GitHub PR head ref, preserving the specific review challenge branch instead of opening only the repository default branch.
- Living-context tree projections now expose context-record linked entities alongside source refs and concepts, preserving the visible multi-entity hyperedge shape needed for graph visualization.
- Role conversations now project answered stakeholder exchanges into source-backed `role_context` graph records with transcript artifacts, exact question/answer spans, linked entities, and open concepts.

### Added — Dev Demo Room and Person Context

- Added a canonical `/people/:personId` profile surface with relationship timeline, source-backed context records, evidence artifacts, and living-context graph visualization; `/person/:personId` now redirects to the shared people profile.
- Branded the standalone video room experience with PIPE logo/loading states and refreshed room chrome while preserving recording, lobby, and call controls.
- Added `npm run smoke:scheduling-invite-dev` to prove the deployed app-dev invite path creates a roleless interview, sends through Cloudflare Email Sending, returns one canonical guest room link, and persists source-backed invite context.
- Simplified demo-facing interview plan language across the sidebar, plan list, and new-plan flow so role context is clearly optional and roleless interviews remain first-class.
- Person and role plan surfaces now use higher-contrast living-context/readability treatments for source-backed context records across light and dark themes, including narrow-drawer chip wrapping for long concept/source labels.
- Improved living-context graph theme contrast and context-record wrapping so source-backed evidence remains readable across light and dark app surfaces.
- Video room signaling now auto-starts host negotiation when a guest joins, prefers TURN relay when TURN credentials are available, and revokes stale host room links when preparing a fresh host URL.
- Host hangup now records the meeting end event before uploading the recording, so transcription and living-context ingestion receive a stable call end timestamp.
- `api-dev` now includes the Cloudflare `DEV_CONTAINER` Durable Object and container image binding, allowing dev-container code-review interviews to launch against the deployed dev API instead of silently missing the runtime binding.
- Deployed PIPE app hosts now default candidate dev-container sessions to the Cloudflare `/rpc` backend and resolve dev-container API calls through the same-origin app proxy, avoiding stale AppSync/localhost routing in `app-dev`.
- The authenticated `app-dev` proxy now preserves candidate `Bearer` session tokens when the dev auth cookie is present, allowing `/rpc` candidate routes such as dev-container launch/status to authenticate through the app domain.
- Dev-container sessions now start the code-server container before marking a session `READY`, and the dev preview image prepares `/workspace` then runs code-server as root so Cloudflare Containers beta can boot the IDE reliably.
- Dev-container iframe access now converts the one-time exchange token into a scoped proxy cookie, so code-server redirects and assets continue loading inside `app-dev` without leaking the candidate session token.

### Fixed — Contact Living Context Graph

- Interview detail transcript refresh now runs as a background update, not a full-page loading reset, and only polls while a recording/transcript is actively processing.
- The shared API client hook now keeps a stable client instance while still reading the latest Clerk token, avoiding render/effect churn on detail pages that poll.
- Contact/people drawer context now renders the shared living-context graph from `/api/v1/contacts/:id/living-context` instead of incorrectly treating the contact ID as a candidate ID.
- Empty contact living-context responses now preserve the shared read-model shape, including `contextRecordCount` and `contextRecords`.
- Contact living-context identity now follows the stable legacy contact link before email lookup, so contact email edits update the same person/workspace graph instead of forking it.
- Contact living-context reads now promote legacy contacts into the living graph before loading the read model, and the MVP browser smoke now asserts a same-email contact plus roleless candidate share one person/workspace graph while preserving exact intake source text.

### Fixed — Challenge Matching Provenance Guardrails

- Candidate-to-PR matching now rejects stale or hand-shaped `review_challenge_packets` with `PACKET_PROVENANCE_INVALID` before recall/ranking by recomputing packet IDs, packet content hashes, demand IDs, demand hashes, demand-family consistency, row PR consistency, and source-hash consistency.
- Match explanations, cockpit candidate profiles, and the `LivingContextGraph` diagnostics now preserve and render invalid packet provenance failures so reviewers can see why a repo packet was excluded instead of receiving an opaque no-match result.
- Match decision context records now persist the selected/considered review packet content hash, and living-context persistence rejects missing or mismatched `review_challenge_packet` source hashes.
- Matcher regression coverage now uses packets persisted through `buildChallengePacket` + `persistReviewChallengeGraph` for valid selection paths, and keeps hand-shaped packet rows only as invalid legacy fixtures.
- Candidate-to-PR matching now excludes otherwise valid packet rows until their `repo_challenge_packet` context record has repo source-span refs and concept links, keeping matcher eligibility aligned with the source-backed graph projection.
- Cockpit candidate profiles now preserve graph-context projection failures from rejected review packets instead of collapsing them into a generic no-match gap.
- Standalone code-review challenge loading now reconstructs candidate-facing diffs only from context-ready review packets with `repo_challenge_packet` records, repo source-span refs, and concept links.
- Pipeline auto-build now selects CODE_REVIEW PRs only from context-ready review packets with `repo_challenge_packet` records, repo source-span refs, and concept links.
- Pipeline auto-build now uses persisted role context concepts before legacy persona skill strings when selecting a source-backed CODE_REVIEW PR, preserving simple-JD/open-concept semantics in challenge selection.
- Pipeline auto-build can now build CODE_REVIEW-only stations from source-backed role context concepts when legacy `mustHaveSkills` are absent, selecting repos through context-ready review packet overlap instead of fabricating skill constraints.
- Pipeline CODE_REVIEW candidate assignments are now revalidated against context-ready review packets before reuse, and stale assignment rows are refreshed through deterministic matching instead of serving legacy repo/PR overrides.
- Standalone CODE_REVIEW cached repo/PR matches are now revalidated against context-ready review packets before being reused, so stale scheduled-interview rows without source-backed graph context fall back to deterministic rematching.
- Multi-turn CODE_REVIEW session init now shares the source-backed review packet diff loader and returns `WAITING_FOR_MATCH` without creating a session when an assignment-backed PR lacks context-ready graph provenance.
- Recruiter candidate profiles now hydrate standalone CODE_REVIEW selected packet metadata only from context-ready review packets; legacy `MATCHED` rows without source-backed graph context render as explicit no-safe-challenge gaps instead of polished PR matches.
- Assignment-backed CODE_REVIEW challenge serving now ignores stale challenge-level cached diffs and reconstructs candidate-facing diffs from context-ready review packet source spans, returning `WAITING_FOR_MATCH` if packet graph provenance is unavailable.
- Multi-turn CODE_REVIEW implementer and explainer prompts now use the same assignment-aware source-backed PR context loader, preventing stale cached diffs from entering review transcripts or explanation exchanges.
- Assignment-backed CODE_REVIEW scoring now reconstructs scorer diff context from context-ready review packet source spans and drops generic challenge planted-bug ground truth, preventing stale challenge fixtures from becoming living-context score evidence.
- Recruiter transcript analysis now hides generic challenge ground truth/server config for assignment-backed CODE_REVIEW sessions and reports source-backed packet readiness plus PR metadata instead of stale challenge fixtures.
- Assignment-backed CODE_REVIEW PR descriptions now come only from source-backed packet metadata across challenge serving, prompts, scoring, and transcript analysis, avoiding fallback to generic challenge text.
- Standalone CODE_REVIEW challenge serving now fails closed when source-backed packet spans cannot reconstruct the diff, instead of live-fetching GitHub data outside the graph provenance gate.
- Standalone CODE_REVIEW E2E fixture repos are no longer marked `swe_bench_eligible`, preventing the crawler-backed challenge packet backfill from treating synthetic local fixture repos as real GitHub PRs.

### Fixed — Repo Graph Projection

- `ingestReposToNeo4j` now treats Neo4j as a rebuildable projection from D1: local database discovery is configurable, and `--dry-run` no longer opens Neo4j, writes projection rows, or generates embeddings.
- `ingestReposToNeo4j` no longer synthesizes metadata-only repo searchable profiles when Pass-3/source-backed profile evidence is missing; repos without `repo_searchable_profile` now fail closed and are skipped from the semantic projection.
- `ingestReposToNeo4j` now projects PullRequest nodes only from production-ready review challenge packets that have `repo_challenge_packet` context records, repo source refs, and concept links, excluding fixture/disabled/incomplete packet rows instead of projecting raw sampled PR metadata.
- Neo4j repo nodes now keep semantic type as `node_type` data instead of using a fixed label/whitelist taxonomy, and repo match queries consider all embedded repo nodes so previously unseen repo concepts survive projection and matching.
- Neo4j PullRequest projection text now comes from source-backed review packet JSON demand/body content and discards crawler `repo_sample_prs.pr_narrative` embeddings, preventing generic PR summaries from becoming projected match/search evidence.
- Legacy `backfillNeo4j --repos` now fails closed instead of projecting old `repo_nodes` compatibility rows; repo Neo4j projection must be rebuilt through `ingestReposToNeo4j` from D1 source-backed packet/context records.

### Added — Review Graph Readiness Gate

- Added `checkReviewChallengeGraphReadiness.ts` plus `review-graph:readiness` / `review-graph:rollout-gate` worker scripts to compose local graph migration prep, packet-context auditing, and optional GitHub API preflight into one rollout report.
- The readiness gate fails closed with explicit next actions for missing graph tables, no backfilled packets, fixture-only packets, incomplete packet context projections, and GitHub API connectivity failures.
- Remote review-graph readiness now emits remote-specific migration guidance when crawler data exists but graph/context tables are not yet applied, instead of pointing operators at the local D1 prep script.
- `backfillReviewChallengePackets` write mode now refuses to fetch or persist until all review graph/context tables are present, with the full required migration list in the error.
- `backfillReviewChallengePackets --json` now emits a machine-readable rollout report with mode, target, filters, batch size, deterministic stats, and row-level PR outcomes with packet IDs/content hashes when built plus persisted context-record/source-ref/concept-link coverage for write-mode packets, while keeping progress logs on stderr.
- Added `checkReviewGraphBackfillReport.ts` and wired the manual Review Graph Rollout workflow to fail closed unless dry-run mode builds at least one eligible packet or write mode persists at least one context-ready packet.
- Review graph backfill report gating now also requires extracted structural facts for ready dry-run and persisted packet outcomes, so repo rollout cannot pass with source spans/concepts but no code-structure decomposition.
- Added a manual Review Graph Rollout workflow that can apply production D1 migrations, run a bounded dry-run or write-mode review packet backfill, run GitHub preflight, validate dispatch inputs, and upload before/after/final readiness plus backfill JSON artifacts.
- The repo crawler workflow now uploads a non-blocking remote review-graph readiness report after pass 2 so ops can watch packet/context/source/concept coverage before converting it into a hard rollout gate.

### Added — Matching Evaluation Readiness Report

- CI now uploads a non-blocking matching evaluation readiness report when Cloudflare D1 credentials and `MATCHING_EVALUATION_CORPUS_ID` are configured, using the existing production expert-label gate rather than any synthetic corpus fallback.

### Added — Match Explanation Visualization Proof

- Match evidence node badges now accept open-ended semantic node types and render data-derived labels, so previously unseen node classifications remain visible instead of being constrained to a fixed frontend taxonomy.
- Added a focused `LivingContextGraph` component regression proving standalone CODE_REVIEW match explanations render candidate source snippets, PR demand snippets, evidence gaps, recalled packets, excluded packets, and stretch diagnostics in recruiter-visible context.
- Added a `LivingContextGraph` regression for crawler/backfill-shaped CODE_REVIEW match explanations, proving accumulated resume and meeting evidence can render against repo source spans for previously unseen concepts in the repository overlay.
- Candidate profile CODE_REVIEW match explanations now preserve `sourceRefType`, `sourceRefId`, and `sourceSpanId` in public source refs so recruiter surfaces and downstream audits can distinguish candidate spans from repo spans.
- `LivingContextGraph` repository source cards now expose source ref type, source ref ID, source span ID, and content hash as stable DOM data attributes for browser/E2E provenance assertions.
- Standalone CODE_REVIEW §MVP.8 now asserts the browser-rendered repository overlay retains candidate `source_span` IDs and repo `repo_source_span` IDs from the seeded source-backed match fixture.
- Added a worker-level matcher proof that builds a production-ready repo challenge packet through `buildChallengePacket` + `persistReviewChallengeGraph`, then matches source-backed candidate evidence against the persisted packet and verifies candidate/repo source refs survive into the match explanation and context record.
- Candidate-to-PR match explanations now expose role/JD provenance as `roleSources`, and matcher regressions verify the same role source refs persist into `match_runs.query_json` plus the `candidate_pr_match_decision` context record.
- Candidate profile CODE_REVIEW match summaries now parse `roleSources` back out of persisted `match_runs.query_json`, and `LivingContextGraph` renders those role/JD source locators next to the selected PR evidence.
- Standalone CODE_REVIEW E2E seeding can now create source-backed simple-JD role context records, run deterministic matching with those role semantics, and browser-verify the rendered CONTEXT graph shows role, candidate, and repo provenance together.
- Added a repo-discovery conversion proof that mocked GitHub PR fetch data flows through `convertRepoToChallenge`, persists a production-ready packet, selects that packet via deterministic candidate matching, and records exact candidate/repo source refs plus an explicit unmatched-demand evidence gap.
- Added a runner-level backfill proof that selects a crawled `repo_sample_prs` row, fetches PR refs/diff/source content through injected fetchers, persists the source-backed packet, and feeds deterministic candidate matching with exact candidate/repo source refs.
- Extended the runner-level backfill/matching proof so a previously unseen concept survives as distinct resume and meeting evidence, accumulates into candidate query atoms, matches a repo source identifier, and remains visible in the selected source-backed match explanation.
- Standalone CODE_REVIEW E2E fixture seeding now builds normalized PR evidence with source artifacts, versions, spans, symbols, structural facts, production challenge packets, and repo semantic projections, then persists through `persistReviewChallengeGraph` instead of hand-writing `review_challenge_packets`.
- `LivingContextGraph` now renders explicit meeting evidence cards from transcript-backed interactions, including artifact/source-span counts, exact transcript snippets, context records, assertions, and accumulated signal labels.
- `LivingContextGraph` meeting evidence now groups scoped context records by shared source spans, so meeting-level transcript hyperedges render inside the interaction branch even when the record itself is scoped to `meeting` rather than a rigid interaction edge.
- `LivingContextGraph` now renders a repository evidence overlay for standalone CODE_REVIEW matches, grouping persisted PR demand source refs by demand/file locator and showing the aligned candidate source refs without adding semantic inference in the UI.
- Added a candidate profile route regression proving `GET /api/v1/candidates/:id` assembles standalone CODE_REVIEW match explanations from persisted `match_runs`, scheduled interview, repo, and PR rows without dropping source refs, gaps, diagnostics, or review submission summaries.
- `GET /api/v1/candidates/:id` now exposes `scheduledInterviews` as public camelCase profile data, including pipeline-free standalone CODE_REVIEW interviews, so E2E/recruiter surfaces can verify interview status without relying on private DB-shaped fields.

### Added — Tree Projection UI Over Semantic Hypergraph

- Added `ContextRecordTree` component (`src/components/Candidate/ContextRecordTree.tsx`) — renders source-backed hyperedge/context records as expandable tree nodes with entities, concepts, and source spans as children. Each source span is clickable and populates the existing source evidence inspector.
- Added `ContextRecordForest` wrapper for rendering the full set of context records.
- Wired context records into the `LivingContextGraph` canvas as a first-class section (above signals), filtered by selected interaction and search query.
- Added `contextRecordCount` to the summary metrics row.
- Added 8 Vitest tests covering collapsed/expanded states, entity/concept/source rendering, source selection callback, polarity indicators, and empty-record handling.
- Context record trees now render non-span provenance refs such as `review_challenge_packet` as static source chips with source type, source ID, content hash, and exact text instead of pretending they are clickable transcript spans.

### Fixed — Test Infrastructure Consolidation

- Migrated 10 living-context and matching test files from `node:sqlite` + inline mock to shared `better-sqlite3` + `createMockD1` helper, eliminating ~650 lines of duplicate boilerplate.
- Added CamelCase boundary splitting to `normalizeOpenTermSurface` so `TypeScript` → `term:type-script` and `SomeNewTechnology` → `term:some-new-technology` — previously unseen CamelCase concepts are no longer collapsed.
- Updated `probeLibrarian` and `planner` tests to match the current 9-probe signal library (added `probe_9_codebase_organization`).
- Fixed `unifiedAgentRuntime` integration tests: `role_discovery` plugin now requires an LLM provider; added a deterministic mock provider.
- Updated `conceptRegistry` test expectation for CamelCase normalization.

### Added — Living Context Graph Tracker

- Added `docs/plans/living-context-graph-tracker.md` — canonical acceptance tracker, PR ledger, merge gates, and autonomous agent operating model for the living context graph goal.

### Changed — E2E Test Reliability

- Worker health checks now respond at both `/health` and `/api/health`, and Playwright local `webServer` readiness uses `/api/health` so stale compatible local API servers no longer block focused E2E startup.
- Playwright local `webServer` commands now derive the Worker and Vite ports from `API_BASE` / `APP_BASE`, so focused E2E runs can use alternate ports when stale local servers occupy `8787` or `5173`.
- Standalone CODE_REVIEW §MVP.4 now requires thin-evidence candidates to receive `WAITING_FOR_MATCH` exactly, with no repo URL, PR number, or cached diff, proving fail-closed matching instead of accepting ambiguous fallback states.
- Standalone CODE_REVIEW §MVP.6 now seeds source-backed candidate evidence plus an unseen-concept repo challenge packet through a guarded local/test route, then requires `/rpc/get-challenge` to return a real `CODE_REVIEW` with PR metadata, packet-derived diff, match diagnostics, and candidate/repo source refs.
- Standalone packet-backed review challenges now render from persisted repo source spans before attempting a live GitHub fetch, so local E2E proves D1 source provenance without depending on network availability or fixture repos existing on GitHub.
- Standalone CODE_REVIEW submissions now fail closed with `409 WAITING_FOR_MATCH` until a source-backed PR has been selected, and §MVP.7 now proves the full intake → match → CODE_REVIEW → submission → recruiter match-summary path.
- Standalone CODE_REVIEW §MVP.8 now opens the recruiter CONTEXT tab after a submitted matched review and asserts the rendered living graph shows the selected PR, candidate review summary, annotation, candidate source snippet, PR demand source snippet, repository evidence overlay, recalled packet, and evaluated challenge diagnostics.
- Living context read models now include shared meeting transcript artifacts and source spans through `artifact_interactions`, so a contact's meeting evidence remains visible after the same person later joins the roleless talent pool as a candidate.
- Standalone CODE_REVIEW §MVP.7 now submits through the real `{ order, submission }` candidate RPC contract and verifies completion in the same deterministic flow instead of relying on parallel test ordering.
- Alternate-port Playwright runs now inject `VITE_API_URL` and `VITE_API_BASE_URL` into the Vite dev server so browser UI assertions hit the same Worker/database as API setup requests.
- Worker CORS now accepts local `localhost` / `127.0.0.1` dev origins on arbitrary ports, allowing focused Playwright runs to avoid stale default-port servers without browser fetch failures.
- `LivingContextGraph` now exposes a stable `data-testid="living-context-graph"` root so E2E coverage can assert the real graph surface instead of fragile text selectors.
- Centralized `API_BASE` / `APP_BASE` into `e2e/env.ts` (reads `process.env` with localhost fallbacks) so specs work against both local dev and deployed Cloudflare test env.
- `playwright.config.ts` now skips local `webServer` startup when `IS_REMOTE` (running against deployed test env).
- `.github/workflows/e2e-test.yml` now passes `E2E_EMAIL`, `E2E_PASSWORD`, and `CLERK_PUBLISHABLE_KEY` to the Playwright step.
- Added `test:e2e:ci` npm script for consistent CI invocation.

### Fixed — Evaluation Harness

- Migrated evaluation CLI test and `evaluateMatching.ts` script from experimental `node:sqlite` to `better-sqlite3`, fixing test failures on Node 20 (CI) and Node 22 without `--experimental-sqlite`.
- Prevented `--allow-synthetic` fixture-mode evaluations from being persisted as acceptance evidence.
- Hardened the shared `runEvaluation()` persistence path so direct callers cannot store results with the expert-label gate disabled or with synthetic/zero-expert corpora.
- Added a read-only latest persisted evaluation readiness gate (`--check-latest-production-pass`) for staged rollout checks.
- Added shared `mockD1` helper (`src/__tests__/helpers/mockD1.ts`) for D1-style `?N` parameter rewriting with better-sqlite3.
- Added test: synthetic labels are rejected when `--allow-synthetic` is omitted (`requireExpertLabels` gate).
- Added test: forbidden expert labels trigger guardrail violation detection.
- Added test: missing provenance in ranked results is detected and fails acceptance.

### Added — Video Meeting Brain Proof

- Added a route-level meeting room proof that creates a meeting, mints a guest room token, uploads a host recording, drains transcript processing, then verifies the recorded guest transcript assertion, exact source span, open concept, and signal survive when the same email later joins as a roleless talent-pool candidate.
- `meetingTranscript.test.ts`: Added focused proof test (`grows a person-centered living context graph from a meeting transcript`) verifying the complete person-graph growth chain: person/workspace_people identity, meeting interaction, immutable artifact version, exact source spans, semantic assertion with open predicate, persisted concept/signal, signal snapshot, projection outbox entry, idempotency, and corrected-transcript immutable versioning.
- Fixed mock D1 adapter (`normalizeD1Params`): `node:sqlite` does not support D1-style `?1` numbered parameters with positional bindings — the adapter now rewrites `?N` to plain `?` and reorders bindings accordingly, unblocking all 5 previously broken async tests.

### Added — Standalone CODE_REVIEW Text-Based Intake Seam

- `workers/api/src/routes/rpc.ts`: `parseIntakePayload()` now also recognizes `{ resumeText }` payloads (previously only `{ resumeR2Key }`), enabling text-based evidence submission for standalone CODE_REVIEW candidates without requiring an R2 file upload.
- `workers/api/src/routes/rpc.ts`: `handleIntakePayload()` runs `runCandidateIngestion` directly from plain-text resume evidence when `resumeText` is provided (≥20 chars), sets a synthetic `resume_s3_key` so the intake gate clears, and proceeds to deterministic matching.
- `e2e/standalone-code-review-mvp.spec.ts`: §MVP.4/§MVP.6 tightened to use correct `submit-challenge-response` endpoint with proper `{ order, submission: { resumeText } }` payload shape (previously referenced non-existent `/rpc/submit-intake`).
- `e2e/standalone-code-review-mvp.spec.ts`: §MVP.8 assertions now verify `standaloneReviewMatch` (the actual API field) including source-backed `evidence[].candidateSourceRefs` and `evidence[].challengeSourceRefs`, not the previously incorrect `matchResult`.

### Fixed — Security: MCQ scoring ground-truth leak

- `POST /rpc/score-submission`: feedback for incorrect MCQ answers no longer reveals the `correctOptionId` from `server_config`. The response now returns `"Incorrect answer"` instead of `"Incorrect. The correct answer was {id}"`.

### Fixed — Repo Semantic Graph Persistence Tests

- Fixed `node:sqlite` compatibility in test D1 shim: numbered params (`?1, ?2`) are normalized to positional `?` placeholders for Node 22.12's experimental `node:sqlite` module.
- Added `force-rebuild produces byte-identical rows and preserves exact source span text` test proving deterministic, idempotent backfill with full provenance verification.
- Added `marks ineligible packets when provenance is incomplete` test proving packets below quality thresholds are rejected from matching eligibility.

### Added — UI Visualization Plan Handoff

- `knowledge/docs/handoffs/2026-06-14-ui-visualization-plan-handoff.md`: Report-only handoff covering current living context UI surfaces, missing meeting-memory surfaces, proposed IA (person timeline, source evidence drawer, assertion/signal cards, match overlay, repo evidence panel), minimal MVP screen sequence, exact components to touch, and contract changes needed before implementation.
- `apps/meetings/src/pages/MeetingsPage.tsx`: Added `data-testid="meeting-intelligence"` to the transcript summary section for future E2E testability.

### Added — Cloudflare Test Environment

- Provisioned test Cloudflare resources and wired `env.test` in `workers/api/wrangler.jsonc` with the `pipe-db-test` D1 binding, `pipe-assets-test` R2 bucket, AI binding, and 1024-dimension test Vectorize indexes for E2E CI.

### Added — Standalone CODE_REVIEW MVP E2E Skeleton

- `e2e/standalone-code-review-mvp.spec.ts`: Failing Playwright BDD skeleton for the standalone code-review MVP flow
  - §MVP.1: Recruiter creates standalone CODE_REVIEW invite (API + UI)
  - §MVP.2: Candidate token resolution for pipeline-free invite
  - §MVP.3: Intake before code review (stage config + challenge content)
  - §MVP.4: Deterministic fail-closed matching — no generic/smallest-PR fallback
  - §MVP.5: Candidate opens /assess/:token, sees intake before diff
  - §MVP.6: Matched candidate receives real PR with metadata
  - §MVP.7: Standalone code review submission + interview completion
  - §MVP.8: Recruiter inspects context graph, match explanation, source evidence

### Added — Standalone CODE_REVIEW Recruiter Context Slice

- `GET /api/v1/candidates/:candidateId`: now returns `standaloneReviewMatch` for pipeline-free CODE_REVIEW invites, including safe pending states, selected PR metadata, match-run score, source-backed alignment refs, and explicit guardrail/evidence gaps.
- Recruiter `CONTEXT` tab: added a standalone CODE_REVIEW match panel that shows pending intake, matched PRs, source-backed candidate→PR evidence, submitted review summaries/annotations, and safe no-match reasons alongside the living context graph.
- Standalone CODE_REVIEW match evidence now carries exact candidate and PR source snippets into recruiter CONTEXT so alignments are inspectable without relying on opaque artifact IDs.
- Candidate `/assess/:token`: fixed standalone CODE_REVIEW waiting-state rendering so resume intake can safely transition through `WAITING_FOR_MATCH` until deterministic matching has enough source-backed evidence.
- `e2e/standalone-code-review-mvp.spec.ts`: added BDD coverage for the recruiter-visible pending-intake state after creating a standalone CODE_REVIEW candidate.
- Workers typecheck: restored strict compatibility for role-discovery guard retries, Cal.com event type normalization, and question reasoning extraction.

### Changed — Source-backed Candidate-to-PR Matching Proof

- `workers/api/src/lib/repoSemanticGraph/challengePacket.ts`: PR challenge packet concept extraction now preserves source identifier components from paths, symbols, signatures, imports/calls, and test metadata in addition to full open terms. This keeps repository semantics source-backed while allowing terms such as `term:rest` to survive from identifiers like `ts-rest`.
- PR challenge packet concept extraction now also preserves raw CamelCase identifier parts as open semantic terms, so identifiers like `CrystallineQuorumLedger` survive as phrase-level source-backed concepts instead of collapsing only into individual word tokens.
- `workers/api/scripts/testLocalChallengeMatch.ts`: Added `--commit` for intentionally persisting a local match run; default behavior remains rollback-only for probes.
- Local D1 proof run: after replaying the living-context backfill, candidate `4c1bee04-264e-4eea-afae-4b2d2dd894ba` matched `mui/base-ui#973` via persisted `match_runs.id = 2346db17-f7d5-415f-95a3-73da39f94751` with complete candidate and challenge source references.

### Added — Persisted Concept Registry

- `workers/api/migrations/0094_concept_registry.sql`: D1 schema for persisted concept registry with versioning, provenance tracking, and replayable resolution
  - Enhanced `concepts` table with resolver_version, model_version, confidence, observation metadata, and supersession tracking
  - `concept_surfaces` table for observed surface text with source span and artifact provenance
  - `concept_resolutions` table for versioned, replayable concept resolution history
  - `concept_adjacency` table for stretch path relationships (technology, mechanism, domain, scale, review_practice)
  - Triggers for automatic observation count updates and first_observed_at initialization
- `workers/api/src/lib/livingContext/conceptRegistry.ts`: Concept registry CRUD operations with versioning
  - `registerConcept()`: Register new concepts or add surfaces to existing concepts with provenance
  - `resolveConcept()`: Resolve surface text to canonical keys with versioned, replayable resolution
  - `getConcept()`, `getConceptFaces()`, `getConceptResolutions()`: Query operations
  - `addAdjacency()`, `getAdjacencies()`: Stretch path relationship management
  - `backfillOpenTerms()`: Deterministic backfill from existing semantic assertions
- `workers/api/src/lib/challengeMatching/roleGuardrails.ts`: Updated to register role concepts in persisted registry during compilation
- `workers/api/src/lib/challengeMatching/d1Matcher.ts`: Updated to register candidate-discovered concepts during signal loading
- `workers/api/src/lib/livingContext/__tests__/conceptRegistry.test.ts`: Test suite proving invented concepts survive without code changes (per ADR-043)
- Per ADR-043: No hard-coded semantic taxonomy; concepts are data-driven with open keys, versioned resolutions, and source-backed provenance

### Added — Matching Evaluation Harness

- `workers/api/src/lib/challengeMatching/evaluation/`: Production evaluation harness for deterministic candidate-to-PR matching
  - `types.ts`: Versioned expert-label corpus format, evaluation metrics, and acceptance thresholds
  - `corpus.ts`: Corpus validation, loading, and query functions
  - `metrics.ts`: Deterministic metrics (Recall@50, Precision@3, nDCG@5, guardrail violations, determinism verification)
  - `cli.ts`: CLI interface for evaluating persisted match runs with JSON and human-readable reports
  - `__tests__/evaluation.test.ts`: Comprehensive test suite with previously unseen semantic concepts (per ADR-043)
- `workers/api/migrations/0093_matching_evaluation.sql`: D1 schema for expert-label corpora and evaluation results
- `workers/api/scripts/evaluateMatching.ts`: Evaluation script entry point
- `workers/api/fixtures/evaluation/sample-corpus.json`: Sample synthetic fixture corpus for testing
- `workers/api/src/lib/challengeMatching/index.ts`: Export evaluation module
- Production acceptance thresholds: Recall@50 ≥ 0.95, Precision@3 ≥ 0.80, nDCG@5 ≥ 0.80, zero guardrail violations, byte-identical reruns
- Per ADR-043: No hard-coded semantic taxonomy; corpus uses open concept keys and does not enumerate skills, domains, or semantic edge types

### Added — PDL Candidate Sourcing + Interaction-First Graph Integration

- `workers/api/src/lib/pdl.ts`: People Data Labs client — Person Search API (Elasticsearch queries) and Person Enrichment API. Pay-as-you-go candidate discovery.
- `workers/api/migrations/0092_sourcing_pool.sql`: Workspace-scoped cache of discovered people. Ephemeral (30-day expiry). Deduplicated by PDL ID. Tracks status: discovered | flagged | dismissed | contacted | converted.
- `workers/api/src/routes/outreach/pdlSearch.ts`:
  - `POST /api/v1/outreach/search` — reads from sourcing_pool cache first, then PDL on miss. Returns results with `poolId` for action tracking.
  - `POST /api/v1/outreach/flag` — mark a discovered person as interesting.
  - `POST /api/v1/outreach/dismiss` — remove from active results.
  - `POST /api/v1/outreach/contact` — first interaction endpoint. Promotes from sourcing pool to living context graph: creates `Person` (deduplicated by email), `WorkspacePerson`, `Interaction` (type: phone|email|invite), and `PersonRole: discovered`. Removed premature `POST /save` that created legacy `Contact` rows.
  - `POST /api/v1/outreach/enrich` — enrich a known person by name/email/company.
- `src/pages/ContactsPage.tsx`:
  - New "Source" tab with PDL search form (job role, level, company, country, has phone/email).
  - Results show name, title, company, email, phone, location.
  - Actions per result: `FLAG`, `DISMISS`, `CALL`, `EMAIL`, `INVITE` (interaction-first; no premature "Save").
  - `CALL` / `EMAIL` / `INVITE` promote the person to the living context graph and create an `Interaction`.
  - `FLAG` marks for follow-up without creating graph nodes.
  - `DISMISS` removes from the active view.
  - Contacted people show "In graph" badge.
- `src/App.tsx`: Sidebar now routes to Contacts (`/contacts`) instead of Outreach. Contacts page reachable from sidebar.

### Changed — PDL Search: SQL → Elasticsearch + Natural Language UI

- `workers/api/src/lib/pdl.ts`: Replaced brittle SQL string concatenation with Elasticsearch `query` DSL.
  - `bool.should` with `minimum_should_match: 1` for focused job title matching (`term` on `job_title_role` + `match` on `job_title` with `operator: 'and'`).
  - `bool.filter` with `terms` for array fields (`job_title_levels`, `skills`).
  - `exists` queries for `emails` and `phone_numbers` — no more "use subfields" errors.
  - Quality gates: `exists` on `full_name` and `job_title` so results without names or titles are excluded.
- `workers/api/src/routes/outreach/pdlSearch.ts`: Added safety-net client-side filter requiring both `full_name` and `job_title` on PDL responses.
- `src/pages/ContactsPage.tsx`: Replaced rigid 4-field grid (role, level, company, country) with a single natural language search input.
  - Parses queries like `"software engineer at Stripe in united states"` → role + company + location.
  - Parses `"product manager in Canada"` → role + location.
  - Shows parsed filter chips (role, company, location) for transparency.
  - Retains `Has email` / `Has phone` checkboxes as additional filters.
  - Chips are toggleable: click `×` to exclude a parsed filter from the search (shows strikethrough, click `+` to re-include).
  - Parser respects sentence boundaries: trailing text after a period is ignored.
  - Trailing punctuation is stripped from parsed values (e.g. `"Vancouver."` → `"vancouver"`).
- `workers/api/src/types.ts`: Added `PDL_API_KEY` to Env bindings.

### Added — Meeting Rooms + Living Context Graph Foundations

- `workers/api/src/routes/meetingRooms.ts`: Standalone video room lifecycle with transcript ingestion into living context graph. Semantic assertion extraction from meeting transcripts.
- `workers/api/src/durable-objects/VideoRoom.ts`: Generalized from recruiter/candidate to host/guest roles. Added `/ensure` endpoint for idempotent meeting room initialization.
- `workers/api/src/lib/livingContext/`: Full living context graph persistence — Person, WorkspacePerson, Application, Interaction, Artifact, ArtifactVersion, SourceSpan, Episode, SemanticAssertion, SignalEvidence, SignalSnapshot, SemanticRelationship. Deterministic entity IDs via SHA-256 ingestion keys.
- `workers/api/src/lib/livingContext/compatibility.ts`: `ensureContactLivingContext` and `ensureCandidateLivingContext` adapters — mirror legacy contacts and candidates into the unified person graph.
- `workers/api/src/lib/livingContext/meetingTranscript.ts`: Ingest meeting transcripts into the living context graph with canonical segments, semantic assertions, and signal evidence.
- `workers/api/migrations/0082_living_context_graph.sql`: D1 schema for the full living context graph (people, workspace_people, applications, interactions, artifacts, source_spans, episodes, semantic_assertions, signal_evidence, signal_snapshots, semantic_relationships, projection_jobs).
- `workers/meetings/`: New standalone Worker for meeting management with room token generation and video room orchestration.

### Fixed — Calendly OAuth Scope Error

- `workers/api/src/routes/cockpit/scheduling.ts`: Fixed Calendly OAuth scope parameter format. Changed from `users:read event_types:read scheduled_events:read` (causing malformed error) to `scheduled_events:read` (matching Calendly documentation exactly). Fixed "The requested scope is invalid, unknown, or malformed" error.
- `src/components/Scheduling/provider/CalendlyProvider.tsx`: Fixed frontend OAuth URL generation to use correct scope format `scheduled_events:read` instead of incorrect `users:read event_types:read scheduled_events:read`.
- `src/components/Scheduling/ConnectionSetup.tsx`: Fixed redirect URI consistency by using fixed path `/schedule` instead of dynamic page path. Resolved "does not match the redirection URI used in the authorization request" error during token exchange.
- `src/components/settings/IntegrationsSettings.tsx`: Fixed redirect URI consistency for settings page OAuth flow.

### Added — Calendly Scheduling Link Support

- `src/components/Scheduling/InviteCandidateModal.tsx`: Added Calendly scheduling link option when Calendly is connected. Added scheduling mode selector (Calendly Link vs Manual Time) that auto-selects Calendly when connected. Updated to send `schedulingProvider` and `schedulingUrl` to backend API.
- `src/hooks/useSchedulingConnection.ts`: Added `eventTypes` field to `SchedulingConnectionInfo` interface. Added `schedulingUrl` field to `ProviderEventType` interface. Added `fetchEventTypesForConnection` helper function to fetch event types for a specific connection.
- `workers/api/src/routes/cockpit/scheduling.ts`: Added `GET /connection/:id/event-types` endpoint to fetch event types for a specific connection. Updated `fetchCalendlyEventTypes` to return `schedulingUrl` field. Updated event types return type to include `schedulingUrl`.
- `workers/api/src/routes/cockpit/candidates.ts`: Updated `createCandidateSchema` to accept `schedulingProvider` and `schedulingUrl` parameters. Updated candidate creation to store scheduling provider and URL in `scheduled_interviews` table. Updated email sending logic to use provided `schedulingUrl` if available.

### Changed — ListingPage UI Cleanup

- `src/pages/ListingPage.tsx`: Removed right sidebar with black background and rounded corners. Removed filter controls (all/active/draft/archived). Simplified layout to single-column view with search and action controls in header. Removed unused `Filter` icon import and filter state management.
- `src/pages/ContactsPage.tsx`: Removed unused `typeFilter` state and `setTypeFilter` function to fix TypeScript unused variable warning. Simplified contact filtering to search-only.

### Added — PIPE_BLUE Theme

- `src/contexts/ThemeContext.tsx`: Added `pipe-blue` theme mode with blue color scheme matching marketing site. Added CSS custom properties for blue background (`#0a0e1a`), blue text (`#e8f4ff`), and blue accent (`#6cc3ff`). Added `pipe-blue` to `BackgroundSettings` shader types and `ThemeMode` types.
- `src/components/settings/DisplaySettings.tsx`: Added `PIPE_BLUE` option to theme selector. Added conditional rendering to hide mode toggle and background controls when pipe-blue theme is selected (since it's dark-only). Updated theme switching logic to handle pipe-blue mode.
- `src/components/ui/AppBackground.tsx`: Added pipe-blue shader rendering with radial gradient background matching marketing site blue aesthetic.

### Added — AI Assistant for Meetings App (CopilotKit-Compatible Custom Agent)

- `workers/meetings/src/lib/copilotAgent.ts`: Custom agent following Pipe's pattern. Uses Cloudflare AI binding with Gemma 4 model. Simple keyword-based tool routing (meeting/contact keywords) with ReAct-style tool execution. Works in Cloudflare Workers runtime without Node.js dependencies.
- `workers/meetings/src/index.ts`: Added `/api/copilotkit` endpoint implementing CopilotKit v2 API interface. Converts between CopilotKit request/response format and custom agent format. Enables frontend to use CopilotKit hooks while backend uses custom agent.
- `apps/meetings/src/components/AIAssistant.tsx`: AI assistant panel with AGUI components (`MeetingCard`, `ContactCard`) using `useComponent` from `@copilotkit/react-core/v2`. Agent-controlled UI rendering.
- `apps/meetings/src/App.tsx`: Integrated CopilotKit v2 provider with `@copilotkit/react-core/v2`. AI assistant as right panel with sliding push effect.
- `packages/ui/src/Layout.tsx`: Added `rightPanel`, `rightPanelOpen`, `rightPanelWidth` props for sliding panel support with content push effect.

**Technical Notes:**

- **CopilotKit-compatible custom agent pattern** - Backend implements CopilotKit v2 API interface (`/api/copilotkit`) but uses custom agent that works in Cloudflare Workers
- Frontend uses CopilotKit v2 hooks (`useChat`, `useComponent`) - complies with project rule
- Custom agent uses Cloudflare AI binding directly with Gemma 4 model
- Simple keyword-based tool routing (can be upgraded to full ReAct loop with tool protocol later)
- Works in Cloudflare Workers runtime without Node.js dependencies
- **Future upgrade path** - When CopilotKit v2's package structure or Wrangler's bundler is fixed, can swap backend to real CopilotKit v2 without frontend changes
- Production-ready per Pipe standards

**Lesson Learned: CopilotKit v2 + Cloudflare Workers Incompatibility**

- CopilotKit v2's package structure includes Node.js dependencies (`@hono/node-server`, `express`, `@segment/analytics-node`) at the package level
- Wrangler's bundler (Rolldown) automatically injects `createRequire(import.meta.url)` for CommonJS interop
- `import.meta.url` is `undefined` in Cloudflare Workers bundled output, causing crash at module initialization
- Neither Wrangler aliases, npm overrides, nodejs_compat flag, nor patch-package can fix this bundler-level issue
- Root cause: CopilotKit's monolithic package structure + Wrangler's bundler behavior
- Solution: Implement CopilotKit-compatible API interface with custom agent that works in Workers

### Fixed — Contextual Graph Testing Issues (ADR-050 Handoff)

- `workers/api/src/lib/cultureContextualDecomposition.ts`: Added JSON repair pass and retry logic with shorter phrases instruction to handle LLM output truncation. Increased maxTokens from 1024 to 2048. Reduces silent data loss from malformed JSON.
- `workers/api/src/lib/cultureGenerativePlanner.ts`: Changed return type to include `reason` field for better failure diagnostics. Returns `{ result, reason }` instead of just `result`.
- `workers/api/src/lib/cultureAgent.ts`: Added metric logging for planner fallbacks with reason codes (no_provider, llm_error, parse_error, etc.). Logs conversation graph state when fallback occurs.
- `workers/api/src/lib/contextualTurnPersistence.ts`: Added exponential backoff retry logic (3 retries, 1s base delay) for Neo4j operations. Added `pending_graph_backfill` marking for D1 nodes when Neo4j writes fail, enabling future backfill. Improved error logging to distinguish D1 vs Neo4j failures.
- `workers/api/migrations/0080_candidate_nodes_pending_backfill.sql`: Added `pending_graph_backfill` column to `candidate_nodes` table for tracking nodes that need Neo4j backfill.
- `workers/api/src/routes/rpc.ts`: Changed claimed token error from 404 to 409 CONFLICT. Added lookup for `CLAIMED::` prefixed tokens to handle sessionStorage loss scenario with user-friendly message.
- `src/hooks/useAssessment.ts`: Added handling for 409 CONFLICT response to show "TOKEN_ALREADY_CLAIMED" error.
- `src/pages/CandidateAssessmentPage.tsx`: Added "Link Already Used" error state with user-friendly message for claimed tokens.
- `workers/api/src/lib/__tests__/cultureGenerativePlanner.test.ts`: Updated tests to handle new return type with `reason` field.

### Fixed — Contextual node types rejected by candidate_nodes CHECK constraint

- `workers/api/migrations/0079_candidate_nodes_contextual_types.sql`: rebuilds `candidate_nodes` so the `node_type` CHECK constraint accepts the ADR-050 contextual types (Action/Tech/Org/Person/Reason/Outcome/Situation). Without this, `persistContextualTurn` failed with `SQLITE_CONSTRAINT` on every interview turn and no contextual graph was persisted.

### Added — Contextual Conversation Graph for Culture Interviews (ADR-050)

- `workers/api/src/lib/cultureContextualDecomposition.ts`: Decomposes each interview answer into a typed semantic graph (Action/Tech/Org/Person/Reason/Outcome/Situation nodes; DID/OBSERVED/WITH/REPLACED/BECAUSE/ACHIEVED/IN_SITUATION/AT/WITH_PERSON edges). Phrases carry their context ("chose Kafka for ordered clickstream replay", never "kafka"). Generic answers are discarded — the discard triggers an LLM-written probe quoting the candidate's own words. `buildConversationGraphView` surfaces missing-context gaps (Action without BECAUSE/ACHIEVED, unowned Outcomes) for the planner.
- `workers/api/src/lib/neo4j/contextualGraph.ts`: Mirrors the conversation graph into Neo4j and materializes grounded `(:CandidateNode)-[:SIMILAR_TO {similarity, grounding}]->(:RepoNode)` edges only at ≥0.84 cosine similarity AND shared concrete grounding tokens. `matchReposByGroundedEdges` ranks repos by multi-region grounded overlap (distinct repo node types, then edge count) — explainable by listing the actual edges, no scores surfaced.
- `workers/api/src/lib/contextualTurnPersistence.ts`: Per-turn fire-and-forget pipeline — embeds statement phrases, stores them as `candidate_nodes` (source_type `culture_contextual`), writes the typed graph to Neo4j, and materializes grounded edges.
- `workers/api/src/lib/cultureAgent.ts` + `cultureGenerativePlanner.ts`: Decomposition runs in parallel with turn analysis; probes come from the decomposition's discard rule (template STAR probes only as fallback); the planner receives the live conversation graph and targets missing-context gaps; interviews terminate with `no_new_material` when answers stop yielding new statements (streak ≥ 2 within min/max caps).
- `workers/api/src/routes/rpc.ts`: Repo matching now prefers grounded-edge traversal (`matchReposByGroundedEdges`) with cosine ranking as fallback, and passes the candidate CV embedding into `pickReviewPr` on the pipeline gate and standalone review paths (semantic PR selection instead of smallest-PR fallback).

### Added — Talent Pool MVP: Pipeline-Free Candidate Invites

- **Schema migration** (`workers/api/migrations/0075_optional_pipeline.sql`): `pipeline_id` nullable on `candidates` and `scheduled_interviews` tables; `interview_type` column (`VIDEO`|`TECHNICAL`|`SCREENING`) added to `scheduled_interviews`.
- **Standalone candidate endpoint** (`POST /api/v1/candidates`): Invite candidates without pipeline/role. Creates candidate, ingestion row, optional interview, sends invitation email with conditional templates.
- **Email template** (`workers/api/src/lib/email.ts`): `pipelineName` now optional; inverted conditionals (`{{^pipelineName}}`) render standalone invite copy; `customMessage` block support.
- **Ingestion orchestrator** (`workers/api/src/lib/candidateDiscovery/orchestrate.ts`): Skips match/assign (steps 6-11) when `pipeline_id` is NULL. Candidate stays at "embedded" status — searchable in talent pool without requiring a pipeline.
- **Frontend invite modal** (`src/components/Scheduling/InviteCandidateModal.tsx`): "INVITE CANDIDATE" button on scheduling dashboard; form with name, email, interview type selector, optional schedule, custom message.
- **Assessment page** (`workers/api/src/routes/rpc.ts`): `get-stage-config` returns INTAKE challenge for pipeline-free candidates; `get-challenge` returns CV upload config. Candidates without a pipeline see a resume upload screen at `/assess/:token`.
- **Type updates**: `ScheduledInterview.pipelineId`/`stageId` now optional; `InterviewType` type exported; JWT `pid` nullable; `CandidateVariables.pipelineId` nullable.

### Added — Meetings Worker & Schema (Phase 1, ADR-049)

- `workers/meetings/`: New Cloudflare Worker (`pipe-meetings`) for contacts and meetings — separate deployable from the main API Worker, sharing the same D1 database.
- `workers/meetings/src/routes/contacts.ts`: Full CRUD for contacts (`POST/GET/GET:id/PATCH/DELETE /api/v1/contacts`) with search, type filtering, and pagination. Contacts have type (PROSPECT, CANDIDATE, HIRING_MANAGER, RECRUITER, OTHER), optional `candidate_id` FK, and JSON tags.
- `workers/meetings/src/routes/meetings.ts`: Full CRUD for meetings (`POST/GET/GET:id/PATCH /api/v1/meetings`) with status/type filtering and participant management (`POST/DELETE /api/v1/meetings/:id/participants`). Meetings track lifecycle (SCHEDULED→IN_PROGRESS→COMPLETED), type (DISCOVERY, INTERVIEW, FOLLOW_UP, DEMO, OTHER), and transcription status.
- `workers/api/migrations/0075_contacts.sql`: D1 migration for `contacts` table.
- `workers/api/migrations/0076_meetings.sql`: D1 migration for `meetings` table with transcript and recording fields.
- `workers/api/migrations/0077_meeting_participants.sql`: D1 migration for `meeting_participants` join table with unique constraint on (meeting_id, contact_id).
- Clerk JWT auth middleware for the meetings Worker (mirrors `workers/api/src/middleware/auth.ts`).
- CORS configured for `meet.hire-pipe.com`, `pipe.build`, and local dev origins.

### Added — Contacts & Meetings Architecture (ADR-049)

- `knowledge/docs/decisions/current/ADR-049-contacts-meetings-separation.md`: Architecture decision for separating meetings into its own Worker + SPA. Introduces `contacts`, `meetings`, `meeting_participants` tables. Domain: `meet.hire-pipe.com`.
- `knowledge/docs/decisions/current/TASKS-meetings.md`: Phased implementation plan (5 phases, 30 tasks) — schema, Worker scaffold, SPA, video calls, transcription, scheduling bridge.

### Fixed — Deterministic Discovery Interview Questions

- `workers/api/src/lib/agents/question/domainOrchestrator.ts`: Domain orchestrator now uses calibrated probes from `probeLibrarian.ts` (ADR-041) instead of LLM-generated questions. Probes are served in deterministic order per domain, with LLM fallback only for domains without matching probes (e.g., `why`). Cross-domain probe deduplication prevents the same probe from being asked twice.
- `workers/api/src/lib/agents/question/probeLibrarian.ts`: Added `getProbesForDomain()` and `getSoulProbesForDomain()` — returns calibrated probes matching a domain, adapted for participant role, excluding already-delivered probes. Converts probes to `GeneratedQuestion` shape for domain orchestrator compatibility.
- Added sequential delivery logging throughout `domainOrchestrator.ts` and `probeLibrarian.ts` to confirm deterministic behavior.

### Added — QA Validator Agent

- `workers/api/src/lib/agents/question/qaValidator.ts` (new): Development-mode validation for interview questions. Checks probe sequence, domain alignment, duplicate detection, and context relevance. Runs after each question delivery with console logging. Includes `validateInterviewState()` for end-of-interview consistency checks.

### Improved — Neo4j Graph Write Observability

- `workers/api/src/lib/neo4j/writeCandidateGraph.ts`: Added start/complete logging with duration tracking. Logs node counts, relationship counts, and timing for each candidate graph write.
- `workers/api/src/lib/neo4j/writeRoleGraph.ts`: Added start/complete logging with duration tracking for role graph writes.
- `workers/api/src/lib/neo4j/writeRepoGraph.ts`: Added start/complete logging with duration tracking for repo graph writes.
- `workers/api/src/lib/neo4j/matchingQueries.ts`: Added timing and result count logging for `matchCandidatesForRole()`.
- All three write functions now log a warning when Neo4j config is missing (before throwing), making it visible in logs when the graph layer is unconfigured.

### Fixed — Immediate Candidate Ingestion

- `workers/api/src/routes/rpc.ts`: INTAKE challenge submission and upload-media now run resume ingestion immediately via `waitUntil(processResumeFromR2())` instead of queuing for the 2-hour cron. Candidate graph is live before proceeding to next stage. GitHub enrichment still uses cron queue (external API batching). See handoff `docs/handoffs/2026-05-10-immediate-candidate-ingestion.md`.

### Added — Mode-1 Profile Probe Bank (Phase 2)

- Migration `0069_profile_probe_bank.sql`: table for role-agnostic Mode-1 probes with dimension CHECK constraint.
- `workers/api/src/lib/profileProbeBank.ts`: 18 curated probes across 6 dimensions (career_history, behavioral_depth, cultural, technical, motivation, context). Coverage-driven selector `pickNextProfileProbe()`.
- `workers/api/src/lib/cultureAgent.ts`: dual-mode FSM — `profile_builder` uses profile probe bank; `role_fit` uses existing competency bank. New `advanceProfileBuilderInterview()` and `evaluateProfileBuilderTermination()`.
- `workers/api/src/lib/cultureAgentAdaptive.ts`: skips generative planner for `profile_builder` mode (static-only, no LLM risk on blocking gate).
- `workers/api/src/lib/cultureGenerativePlanner.ts`: relaxed `GenerativePlannerContext.coverage` type to `Record<string, number>` to accept both competency and profile dimensions.
- Tests: `profileProbeBank.test.ts` (11 tests), `cultureAgent.test.ts` (7 tests).

### Added — Swarm QA Infrastructure

- `agent-harness/SWARM_GUIDE.md`: operator runbook for the QA swarm lane.
- `agent-harness/run_qa_swarm.py` + `run_qa_swarm_async.py`: synchronous and asynchronous entrypoints for driving the QA-Deploy swarm agent against a plan.
- `agent-harness/scripts/mcp-docker-bridge.sh` + `mcp-docker-wrapper.py`: MCP bridge for Docker-based tool execution inside swarm lanes.
- `agent-harness/scripts/swarm-dashboard.py` + `swarm-web-dashboard.py`: CLI and web dashboards for real-time swarm lane monitoring.
- `dashboard-screenshot.png`: sample dashboard output.

### Added — Question Agent Guard & Feedback

- `workers/api/src/lib/agents/question/guard.ts`: input guard that validates interview questions against policy (toxicity, PII leakage, off-topic drift) before dispatch.
- `workers/api/src/lib/agents/question/feedbackReport.ts`: structured feedback report generator for question quality audits.
- `workers/api/src/lib/agents/question/promptPatch.ts`: prompt-patch utility for hot-fixing question generation prompts without redeploy.
- `workers/api/src/lib/agents/question/types.ts`: shared TypeScript contracts for the question agent pipeline.
- `workers/api/src/lib/agents/question/__tests__/guard.test.ts`: Vitest suite covering guard pass, block, and edge-case classifications.

### Added — Vertex AI Authentication

- `workers/api/src/lib/llm/vertexAuth.ts`: reusable Vertex AI OAuth2 token refresh and credential caching, extracted from `vertexAIProvider.ts` to enable shared auth across live and batch providers.

### Added — Frontend Interview Components

- `src/components/AIChat/SmartInterviewInput.tsx`: voice-aware chat input with transcription fallback, typing indicators, and sendguard for live interview stages.
- `src/hooks/useVoiceInput.ts`: React hook wrapping Web Speech API with permission handling, interim transcript buffering, and auto-stop on silence.

### Added — Role Agent Sanitization

- `workers/api/src/lib/roleAgent/sanitize.ts`: output sanitizer for RCD synthesis — strips disallowed markup, normalises unicode, and enforces length caps before persistence.

### Added — Strategy V2 QA Swarm Bugfix Plans

- `knowledge/plan/SWARM_QA_SPEC.md`: specification for the automated QA-swarm bugfix pipeline.
- `docs/plans/strategy-v2/qa-swarm-bugfix/` + `knowledge/plan/strategy-v2/qa-swarm-bugfix/`: plan documents for API correctness, observability finish, and stub-to-real migrations.

### Changed — Agent Harness Swarm

- All swarm agents (`advisor.py`, `architect.py`, `chat_agent.py`, `developer.py`, `meta_pm.py`, `orchestrator_agent.py`, `qa_deploy.py`): aligned tool signatures with MCP bridge contract, added heartbeat acks, and standardized error propagation.
- `agent-harness/src/agent_harness/swarm/graph.py`: injected checkpoint persistence between phase transitions.
- `agent-harness/src/agent_harness/swarm/lane_runner.py`: added Docker context isolation, retry budget per lane, and async event streaming.
- `agent-harness/docker-compose.yml`: added `mcp-bridge` service and volume mounts for script hot-reload.
- `agent-harness/scripts/mcp-lazy-wrapper.py`: lazy-loads MCP tools on first invocation to reduce cold-start time.
- `agent-harness/README.md`: updated setup instructions for Docker-based swarm execution.

### Changed — Question Agent

- `workers/api/src/lib/agents/question/generator.ts`: integrated `guard.ts` pre-flight check, added feedback loop on block events, and refactored prompt assembly to use `promptPatch.ts`.
- `workers/api/src/lib/agents/question/prompt.ts`: tightened system prompt to enforce policy compliance and reduced hallucinated citations.

### Changed — Role Discovery & Synthesis

- `workers/api/src/lib/agents/roleDiscovery/prompts.ts`: updated probe prompts to reference sanitized RCD fields and added calibration guidance.
- `workers/api/src/lib/roleAgent.ts`: wired `sanitize.ts` into the synthesis pipeline, added telemetry spans for decomposition timing.
- `workers/api/src/lib/roleAgent/consumerSlice.ts`: normalized Redux action payloads to match sanitized output shapes.
- `workers/api/src/lib/roleAgent/deriveJobDescription.ts`: derives JD from sanitized `role_searchable_profile` instead of raw narrative.
- `workers/api/src/lib/roleAgent/synthesizeRcd.ts`: emits `sanitized_at` timestamp and validation digest.
- `workers/api/src/lib/roleAgentPrompts.ts`: added guard-rail examples for disallowed content.
- `workers/api/src/__tests__/synthesizeRcd.test.ts`: updated expectations to assert sanitized fields.

### Changed — Domain-Driven Interview Flow (ADR-028)

- **Single endpoint architecture**: `POST /:id/respond` is now the only live endpoint for the interview loop. Removed `POST /:id/state`, `POST /:id/question/prefetch`. `POST /:id/question` returns `410 Gone`.
- **Frontend `useRoleDiscovery.ts`**: rewritten to call `/respond` exclusively. Removed `questionStack`, prefetch, and split-endpoint logic.
- **Backend `domainOrchestrator.ts`**: drives column-by-column flow (team → work → bar → codebase → process → why). Generates 6 questions per domain in one LLM call, serves from cache, runs depth evaluator, generates follow-ups if shallow.
- **Backend `reducer.ts`**: overhauled to remove legacy probe counting, hard budget enforcement, and `selectPhase`/`phaseRules`. Now tracks per-domain progress via `domainCompletion`, `domainQuestionsDelivered`, `domainFollowUpsDelivered`.
- **Backend `types.ts`**: `InterviewState` now includes `knowledgeState`, domain-driven fields, and optional `questionStack` for backward compat.
- **Validation schema**: `interviewStateSchema` accepts optional domain-driven fields.
- **Tests**: updated `roleContextsQuestion.test.ts` to expect `410 Gone` for deprecated endpoint.
- **Backend `answerEvaluator.ts`**: lightweight per-answer quality heuristic. Evaluates every answer for substance (length + specificity signals). Thin answers trigger warm, conversational follow-ups instead of rigid batch depth evaluation.
- **Backend `domainOrchestrator.ts`**: rewritten for conversational flow. Reduced questions per domain from 6 to 4, max follow-ups from 3 to 2. After each answer, checks quality and either drills deeper with a warm follow-up or moves on. Domains complete when cache is exhausted — no more broken depth evaluator blocking synthesis.
- **Backend `domainGenerator.ts`**: added robust JSON fallback parser for truncated LLM responses. Increases `maxTokens` to 8192 for streaming path.
- **Frontend `AIChat.tsx`**: removed "Question X of Y" counter, linear progress bar, and old phase badge. Now shows current domain name (e.g., "TEAM") and domain-completion progress (`3 / 6 domains explored`). Progress bar reflects completed domains, not question count.
- **Frontend `DomainBars.tsx`**: highlights current domain with green border, shows completed domains in bright green.
- **Frontend `useRoleDiscovery.ts`**: removed `prefetch`, `questionBudget`, old phase metadata. Exposes `currentDomain` and `domainCompletion`.
- **Frontend `RoleDiscoveryPage.tsx`**: removed `DEFAULT_BUDGET`. Updated AIChat props and resume hydration.

### Changed — Culture Agent

- `workers/api/src/lib/cultureAgent.ts`: switched to shared Vertex auth helper, removed duplicate credential logic.
- `workers/api/src/lib/cultureAgentAdaptive.ts`: added fallback to static question bank when generative planner is rate-limited.
- `workers/api/src/lib/cultureAgentContext.ts`: expanded context window to include prior adaptive answers.
- `workers/api/src/lib/cultureQuestionBank.ts`: seeded additional edge-case scenarios for DEI and remote-work topics.
- `workers/api/src/lib/__tests__/cultureGenerativePlanner.test.ts`: added tests for adaptive fallback path.

### Changed — LLM Providers

- `workers/api/src/lib/llm/createProvider.ts`: refactored provider factory to accept `vertexAuth` dependency injection, unified retry and timeout defaults.
- `workers/api/src/lib/llm/vertexAIProvider.ts`: extracted auth into `vertexAuth.ts`, slimmed provider to pure request/response logic.
- `workers/api/src/lib/llm/live/createLiveProvider.ts`: registered Vertex live provider with shared auth cache.
- `workers/api/src/lib/llm/live/vertexLiveProvider.ts`: adopted `vertexAuth.ts` token refresh, fixed stream termination race.

### Changed — Frontend UI & Theming

- `src/components/ui/AppBackground.tsx`: added animated mesh gradient background with reduced-motion fallback.
- `src/components/ui/LiquidMetalCard.tsx`: improved shimmer performance via CSS containment, fixed border-radius clipping.
- `src/contexts/ThemeContext.tsx`: added system-preference listener and manual override persistence to `localStorage`.
- `src/index.css`: introduced CSS custom properties for the new gradient palette, added `.reduce-motion` media-query guards.
- `src/pages/CandidateScreeningPage.tsx`: integrated `SmartInterviewInput`, added voice-input toggle, and improved loading skeletons.
- `src/pages/CultureInterviewPage.tsx`: streamlined layout, removed deprecated stage-type conditionals, wired adaptive culture agent.
- `src/components/RoleDiscovery/GapFillModal.tsx`: fixed focus trap and added `aria-describedby` for screen readers.
- `src/components/RoleDiscovery/MatchConfigWizard.tsx`: aligned step validation with backend calibration constraints.
- `src/components/RoleDiscovery/RoleContextReview.tsx`: added sanitize-status badge and raw/sanitized diff toggle.
- `src/components/AIChat/index.ts`: exported `SmartInterviewInput`.

### Changed — API Routes

- `workers/api/src/routes/assessment/agentInterview.ts`: added guard pre-check before question generation, returns `403` on policy block with `feedbackReport` URI.
- `workers/api/src/routes/cockpit/candidates.ts`: exposed `sanitized_rcd` flag in list view.
- `workers/api/src/routes/internal/calibrate.ts`: added batch calibration endpoint for role-discovery probe scoring.
- `workers/api/src/routes/screening/culture.ts`: wired adaptive culture agent, added fallback to static bank.
- `workers/api/src/routes/tts.ts`: added voice-selection query param and caching headers.
- `workers/api/src/types.ts`: added `SanitizedRcd`, `QuestionGuardResult`, and `VoiceInputState` interfaces.

### Changed — Tests

- `workers/api/src/__tests__/candidates.test.ts`: added assertions for `sanitized_rcd` field.
- `workers/api/src/lib/ai/__tests__/retryHelper.test.ts`: expanded coverage to include Vertex auth retry paths and exponential-backoff jitter.

### Changed — Scripts & Configuration

- `workers/api/scripts/test-decomposition.ts`: added `--sanitize` flag to exercise `sanitize.ts` against fixture RCDs.
- `workers/api/scripts/validate-providers.ts`: validates Vertex auth refresh flow and live provider handshake.
- `workers/api/.dev.vars.example`: added `VERTEX_PROJECT_ID`, `VERTEX_LOCATION`, and `MCP_BRIDGE_URL` placeholders.

### Added — Repo Decomposition into repo_nodes (Phase 2)

- **Migration `0050_repo_nodes.sql`**: addressable sub-element decomposition for Pass 3 repos. Table `repo_nodes` with 9-type `CHECK` constraint (`Feature`, `ArchitecturalPattern`, `TechnicalStack`, `Construct`, `ChallengeSurface`, `QualitySignal`, `DomainContext`, `PRSample`, `IssueCandidate`), indexes on `(repo_id, node_type)` and `(repo_id, signals_version)`, and dual-layer `embedding_json` per ADR-040.
- **`workers/api/scripts/crawl-repos/pass3/run.ts`**: Pass 3 prompt now asks Gemma to produce structured `sub_elements` JSON alongside the 9 legacy top-level fields. Zod schema (`pass3GemmaOutputSchema`) validates Gemma output before any D1 write. `PRSample` and `IssueCandidate` sub-elements are derived deterministically from existing `repo_sample_prs` and `repo_issues` rows (no Gemma call). Each sub-element gets a BGE-large-en-v1.5 embedding (type-prefixed narrative, document side) and is upserted to `REPO_INDEX` with metadata `{entity_type:'repo', entity_id, node_type, signals_version, admin_status:'approved'}`.
- **`workers/api/scripts/crawl-repos/pass3/persist.ts`**: `persistRepoNodes` performs transactional delete+insert per repo, pre-generates embeddings before D1 write, and batches inserts. `upsertRepoNodesToVectorize` sends batched NDJSON upserts to Vectorize.
- **`workers/api/scripts/backfillRepoNodes.ts`**: backfill script for existing `pass >= 3` repos. Queries repos lacking `repo_nodes`, uses a cheaper Gemma extraction prompt against existing `engineering_narrative` to avoid full Pass 3 re-runs, appends PR/Issue sub-elements, and persists embeddings + Vectorize upserts. Supports `--dry-run`, `--batch=N`, and `--repo-id=<id>`.

### Added — PR Narrative Enrichment & Semantic Selection

- **Migration `0051_repo_sample_prs_narrative.sql`**: adds `pr_narrative`, `pr_narrative_embedding_json`, and `pr_narrative_version` to `repo_sample_prs`.
- **`workers/api/scripts/crawl-repos/pass2/prNarrative.ts`**: new module that generates a Gemma-derived 2–3 sentence narrative per sampled PR (grounded in changed files, constructs, and PR metadata) and embeds it via BGE-large-en-v1.5 (document side).
- **`workers/api/scripts/crawl-repos/index.ts`**: Pass 2 now auto-chains PR narrative enrichment after sampling. Non-fatal: individual PR failures are logged and the original PR is persisted unchanged.
- **`workers/api/scripts/crawl-repos/pass2/persist.ts`**: persists the three new narrative columns into `repo_sample_prs`.
- **`workers/api/src/lib/match/autoStageBuilder.ts`**: `pickReviewPr()` now supports semantic selection. When a candidate embedding is provided, it computes exact cosine similarity between the candidate profile and each PR's narrative embedding, returning the best match above threshold 0.6. Falls back to the existing `ORDER BY changed_file_count ASC` when no embedding is available, no PR clears the threshold, or embeddings are missing. Logs `selectionPath` (`semantic` vs `size_fallback`) for observability.
- **`workers/api/src/lib/match/matchReposForCandidate.ts`**: accepts optional `candidateEmbeddingJson` and forwards it to `pickReviewPr()`.
- **`workers/api/src/lib/candidateDiscovery/orchestrate.ts`**: loads the candidate embedding from `candidate_ingestion.embedding_json` early and passes it through to `matchReposForCandidate` and the re-rank `pickReviewPr` call.
- **`workers/api/scripts/crawl-repos/pass3/run.ts`**: `callGemma()` now accepts an optional `responseMimeType` parameter (default `application/json`) to support plaintext PR narrative generation.

### Added — Unified Agent Runtime (ADR-034)

- `workers/api/src/lib/unifiedAgentRuntime/`: shared FSM, plugin registry, session store, scorer, eval gate, and provider for role discovery, code review, and culture interview agents.
- `workers/api/src/lib/agents/{roleDiscovery,codeReview,culture}/plugin.ts`: per-agent plugins registered via `registerAllPlugins()`.
- `workers/api/src/routes/agents.ts`: unified `/api/v1/agents/*` routes (mounted in `index.ts`).
- `migration/0043_agent_sessions.sql`: unified `agent_sessions` table for cross-agent operational queries.
- `docs/decisions/current/ADR-034-unified-agent-runtime.md`: rationale and consolidation plan.

### Added — RCD Decomposition into role_nodes (Phase 2)

- `workers/api/src/lib/roleAgent/decomposeRcd.ts`: pure extractor `decomposeRcdIntoNodes` turns a `RoleContextDocument` into 11 typed `RoleNodeRow` sub-elements (Requirement, Responsibility, CulturalSignal, TeamContext, Dealbreaker, RedFlag, TechnicalContext, CodebaseExpectation, ProcessExpectation, Conflict, BarsOverride). Each node carries type-prefixed narrative text, structured `extracted_properties_json`, stakeholder attribution, and must/nice weights.
- `persistRoleNodes` in `decomposeRcd.ts`: batched BGE embedding generation, Vectorize `ROLE_INDEX` upsert with metadata, and D1 `role_nodes` INSERT via `db.batch`. Existing nodes for the same `role_context_id` are marked superseded before new ones are written.
- `workers/api/src/routes/discovery/roleContexts.ts`: post-RCD-write hook calls `decomposeRcdIntoNodes` + `persistRoleNodes` in all three synthesis call sites. Errors are caught and logged without failing synthesis.
- `workers/api/src/lib/roleAgent/__tests__/decomposeRcd.test.ts`: 7 Vitest unit tests covering full-population node counts, null-section safety, single-stakeholder extraction, type-prefix narratives, must/nice weight assignment, and meaningful `source_section` paths.

### Added — Role Discovery Evaluator

- `workers/api/src/lib/roleDiscovery/evaluator.ts` + `evaluatorPrompt.ts`: eval-gated question generation (interviewer proposes 2 candidates → evaluator picks the best) for the role discovery agent.
- `workers/api/src/routes/internal/evaluateDiscovery.ts`: internal endpoint for evaluator runs.
- `workers/api/src/lib/roleAgentPrompts.ts`: prompt rewrite to align with the evaluator contract.

### Added — Strategy & Planning Docs

- `knowledge/plan/pipe-strategy-v2-part{1..6}.md`: north-star, role discovery, repo ingestion, candidate ingestion, matching migration, and market research.
- `docs/plans/2026-04-22-eval-gated-pipeline.md`, `docs/plans/2026-04-22-live-rcd-synthesis.md`.
- `docs/handoffs/{discovery-agent-context,phase-2-role-discovery-migration,unified-agent-runtime}-2026-04-23.md`.
- `scripts/research-vector-signals.py`: research helper for vector-native signal exploration.

### Changed

- `migration/PLAN.md`: Phase 5 marked done (Terraform dropped per ADR-041, GitHub Actions live, `amplify/` deleted); Phase 3 marked drifted; Workers route inventory updated to 34 modules; D1 migration count updated to 0001–0042.
- `CLAUDE.md`: added Context Budget section enforcing per-session limits on project files, skills, and persistent memory.

### Removed

- `data/experiments/runs.jsonl` (stale experiment log).
- `knowledge/README.md` (superseded by `knowledge/STRATEGY.md` and the wiki).

### Fixed

- **Cross-tenant leak on `/api/v1/search/roles`:** `matchRolesVectorNative` now joins `pipelines` and filters by `owner_id`; `/roles` handler passes the authenticated user through. Mirrors the existing `matchCandidatesVectorNative` pattern.
- **Silent data corruption in CODE_REVIEW lazy-session INSERT:** `/rpc/review/ask` now derives `implementer_persona` and `max_rounds` from challenge config instead of writing literal `'pending'` into `implementer_persona`.
- **Prop mutation in `ReviewSessionReport`:** rescore now updates a local `localStatus` state instead of mutating `props.session.status`; added optional `onRescore` callback so parents can re-fetch.
- **Duplicate `review-session-loader` test-id:** init-phase loader renamed to `review-session-init-loader`; rounds-phase keeps `review-session-loader`.
- **Missing error state on CODE_REVIEW init:** `CandidateAssessmentPage` now captures init errors and renders a retry button instead of leaving the candidate stuck on a silent loader.

### Changed

- Extracted shared scoring + propagation into `workers/api/src/lib/review/scoreAndPropagate.ts`; `finalizeReviewSession` (in `review.ts`) and `POST /:sessionId/rescore` (in `reviewSessions.ts`) reduce to a single invocation wrapped in `c.executionCtx.waitUntil(...)`. `/rescore` now sets status to `'scoring'` and returns `{ success: true, status: 'scoring' }` immediately, preventing wall-time timeouts on long transcripts.
- Extracted `REVIEW_SESSION_STATUS_COLORS`/`STATUS_LABELS` to `src/lib/reviewSessionStatus.ts` and updated both consumers.
- Review Session Report modal and `GapFillModal` now expose `role="dialog"`, `aria-modal`, labelled heading, and Escape-to-close.
- Telemetry in `orchestrate.ts` is prefixed `[orchestrate]` and drops the redundant intersection cast on `triangulated.raw_signals`.
- Dropped duplicate `challengeId` from the `reviewSession` payload on `GET /rpc/get-challenge` (clients use the top-level `id`).
- Replaced `as unknown as ChallengeConfigRow` casts in `review.ts` with typed `.all<ChallengeConfigRow>()`.
- `roleContextsCalibrate.test.ts` now imports `Context`/`Next` from `hono` instead of typing middleware as `any`.

### Added — Test Environment Infrastructure

- `[env.test]` block in `workers/api/wrangler.jsonc` (bindings commented pending one-time bootstrap).
- `workers/api/scripts/bootstrap-test-env.sh` — creates `pipe-db-test`, `pipe-assets-test`, and three `*-profiles-test` Vectorize indexes.
- `workers/api/scripts/reset-test-db.sql` + `seed-test-db.sql` — idempotent wipe + fixture seed.
- `workers/api/scripts/TEST-ENV.md` — operator runbook.
- `.github/workflows/e2e-test.yml` — apply migrations, deploy worker + Pages, reset/seed, run Playwright serial against real backend.

### Added

**Task B — Role Discovery Agent:**

- Role Discovery agent now uses 6 calibrated probes instead of open-ended Six Domains exploration
- Role Context Document (RCD) is now the primary synthesis artifact
- Added calibration review UI for recruiters to flag and correct RCD attributes
- Added gap-filling agent for targeted clarifying questions
- **Migration `0049_role_nodes.sql`**: derivative sub-element view of RCDs; FK to `role_contexts` with `ON DELETE CASCADE`, 11-type `CHECK` constraint, and partial index on active (`superseded_at IS NULL`) nodes.

**Task C — Code Review Golden Path:**

- CODE_REVIEW stages now create review session on stage entry
- New review session endpoints: `/rpc/review/session/init`, `/message`, `/complete`
- Added dedicated review session page with diff + chat interface
- Recruiter dashboard now shows review session status, score, and transcript

**Infrastructure & Docs:**

- Phase 5 CI/CD: GitHub Actions workflows for CI, staging deploy, and production deploy
- ADR-041: Cloudflare-native deployment with Wrangler (drops Terraform)
- `workers/api/wrangler.jsonc` environments: `staging` and `production`
- `docs/project-brief.md`: Unified project vision, glossary, phased roadmap, and honest current-state snapshot
- `.claude/rules/terminology.md`: Mandatory domain language for all agents
- **Dual-layer embedding architecture (D1 ground truth + Vectorize ANN):** Migration `0042_embedding_json.sql` adds `embedding_json` to `candidate_ingestion`, `repo_engineering_signals`, and `role_contexts`; `role_contexts.role_searchable_profile` stores role narrative. Enables exact cosine computation and index rebuilds from D1.
- **Exact `role_candidate_cosine` computation:** `lib/embedding/cosine.ts` provides `cosineSimilarity()` and `parseEmbeddingJson()`; `orchestrate.ts` loads both embeddings from D1 and computes exact similarity at match time (falls back to `null` if missing).
- **Unified semantic search endpoints:** `POST /api/v1/search/candidates` and `POST /api/v1/search/repos` enable bidirectional search (role→candidates, role→repos, candidate→repos, repo→candidates) using dual-layer embeddings.
- **Role context embedding:** `buildAndStoreRoleEmbedding` fires best-effort when role discovery reaches `COMPLETE`, building `role_searchable_profile` from `job_description_md` and embedding via BGE-large-en-v1.5.

### Removed

- **Deprecated stage types:** Removed all dead stage types (`AI_COLLAB`, `PLANNING`, `VOICE`, `INGESTION`, `TECHNICAL`, `QUESTIONS`, `VOICE_INTERVIEW`) from frontend and backend.
- Locked to exactly 5 stage types: `SCREENING`, `CULTURAL`, `CODE_REVIEW`, `OPEN_SOURCE`, `LIVE_PANEL`.
- Aligned `workers/api/src/validation/stages.ts`, `src/lib/stageTemplates.ts`, `src/types/index.ts`, and all UI components.
- Removed `titleLower.includes(...)` fallback inference patterns in `StageIndexTab.tsx` and `StagePanel.tsx` — stages must have `stage_type` populated.
- Updated pipeline templates to use valid stage types only.
- Cleaned up unused lucide-react imports (Zap, Brain, Mic) from modified components.

### Changed

- `docs/vision.md`: Aligned with project brief — added product thesis, full vision reference, and guardrails
- `migration/PLAN.md`: Added Product Phases (P1–P5) section with 2026-04-22 decisions
- Documentation reorganization: unified navigation hub, split decisions into current/historical, extracted model routing, archived stale artifacts
- Deleted obsolete files: BUGS.md, TEST_ANALYSIS.md, TEST_STATUS.md, TODO.md, CONTRIBUTING.md, docs/README.md, docs/handoffs/
- Deleted AWS Amplify artifacts: `amplify/`, `amplify_outputs.json`, `amplify.yml`
- Deleted Terraform infrastructure: `infra/` directory
- Archived CHANGELOG.md to docs/archive/CHANGELOG-historical.md, restarted fresh
- Moved DREAM.md → docs/vision.md (trimmed to product vision only)
- Moved docs/DRIFT_LOG.md → docs/ops/drift-log.md, docs/audits/ → docs/ops/audits/
- Created docs/ai/model-routing.md as single source of truth for AI routing
- Rewrote CLAUDE.md as pure navigation hub + agent instructions (no content duplication)
- Rewrote root README.md (50 lines)
- Updated internal links across migration docs, knowledge docs, and source files

## [0.0.1] - 2026-04-22

### Added

- Initial changelog
