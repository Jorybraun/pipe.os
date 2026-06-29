# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Fixed — Scheduling

- The authenticated MVP browser smoke now follows the current Interview plans and People UI, injects Clerk's testing token in the smoke context, and retries the initial app-shell load so local route validation fails on product regressions instead of stale selectors or auth handoff flake.
- Interview lists now default to newest-created ordering and include Newest, Timeline, and Oldest controls so recruiters can scan recent invites without losing the existing scheduled-time view.

### Fixed — Video room

- Room chat messages now carry and verify an exact text fingerprint in source-backed evidence, preventing same-length stale or tampered chat payloads from replaying as valid meeting evidence.
- Win95 shared room-surface toggles now require deterministic integer capture times and known room phases before replaying, preventing malformed surface evidence from moving both participants between the standard call and desktop.
- Win95 shared window open/close events now reconstruct lifecycle ids and verify open-window metadata before replaying, preventing stale lifecycle evidence from launching or closing the wrong shared window.
- Win95 shared window-state events now reconstruct state patches, actions, and source ids before replaying, preventing stale move, resize, focus, minimize, or maximize evidence from syncing across participants.
- Win95 shared window-data and browser-navigation events now reconstruct fingerprints and source ids from the exact shared payload before replaying, preventing stale Notepad/Paint/browser state from being accepted as source-backed desktop evidence.
- Win95 shared file-system events and snapshots now require exact saved/deleted file content provenance before replaying, preventing Notepad, Paint, JSON, or link files from hydrating as source-backed evidence from hash-only or stale projections.
- Clippy no longer mounts the unmanaged `clippyjs` paperclip sprite over the Win95 desktop; the controlled tray, proactive card, and chat window remain as the only Clippy surfaces.
- Room-dev now clears stale origin cache only during the basic-auth handoff, while missing old hashed `/assets/*` bundles return 404 instead of the SPA shell so rapid deploys do not leave Safari on a blank stale room bundle.
- Added a deployed Clippy/Devin chat smoke that launches a real dev-container room, waits for `AGENT_READY`, sends a real Devin API prompt, and fails unless the agent response and bridge diagnostics are source-backed and persisted.
- Standard video rooms no longer publish no-op workspace desktop events, removing rejected source-backed evidence console noise while preserving real dev-container workspace diagnostics.
- Win95 peer cursors now render through isolated transform layers instead of top/left repainting, reducing stale cursor trails while preserving shared cursor evidence and sync state.

### Fixed — Candidate repo matching

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

### Fixed — 95 Until Infinity desktop tools

- Room entry now opens the default video/chat/workspace windows synchronously before switching surfaces, preventing users from landing on an empty call-stage background after pressing Enter room.
- Room entry now keeps the prejoin lobby return after all room hooks are registered, preventing React hook-order crashes when pressing Enter room.
- Shared Win95 file-system snapshots now carry compact source-backed file projection evidence and reject source-thin file hydration, so Notepad/Paint files remain reconstructable without copying exact content into metadata.
- Recording snapshots now require the stored room state to reconstruct to source-backed browser MediaRecorder evidence before the room client hydrates recording indicators.
- Media-control snapshots now carry the accepted source-backed browser control evidence into Durable Object state and reject source-thin snapshot hydration in the room client.
- Clippy prompts and Clippy/Devin interaction events now require source-backed browser or bridge provenance before local optimistic display, peer replay, or prompt snapshot hydration, preventing source-less assistant state from appearing as real evidence.
- Room Chat messages now require source-backed browser chat evidence with stable room message ids, client ids, timestamps, lengths, delivery status, surface, and room phase before local optimistic display, peer replay, ACK handling, or room snapshot hydration.
- Meeting transcript evidence now preserves the origin of speaker metadata, distinguishing browser-uploaded channel maps from R2 custom metadata recovered during transcript retry, so speaker attribution remains source-backed across processing passes.
- Rejected Room Chat sends now preserve the Durable Object rejection reason in browser evidence and exact source-ref metadata, so failed chat delivery is explainable instead of only marked as not sent.
- Deleting shared Win95 Notepad/Paint files now clears any open editor window through the shared desktop data channel with `win95_file_delete_sync` provenance, keeping both participants in sync instead of leaving stale local window content.
- Win95 shared file-system mutations now require source-backed browser evidence before local optimistic state or peer replay can change files, preventing source-less Notepad/Paint edits from appearing while disconnected or before Durable Object validation.
- Win95 terminal command/output events now require source-backed browser terminal evidence before local optimistic state or peer replay can show terminal activity, preventing source-less command/output claims from appearing while disconnected or before Durable Object validation.
- Code-server file events now require source-backed Clippy bridge workspace evidence before local optimistic state or peer replay can show editor saves/changes, preventing source-less editor activity from appearing while disconnected or before Durable Object validation.
- Win95 peer cursor presence now requires source-backed browser sample evidence before sending, broadcasting, rendering, or replaying cursor positions, preventing raw pointer packets from leaving unaudited trails across participants.
- Video media controls and recording state now require source-backed browser/MediaRecorder evidence before local optimistic state or peer replay can change call indicators, preventing source-less mute/camera/recording claims from appearing before Durable Object validation.
- Win95 desktop/window events now require source-backed surface, menu, lifecycle, data, state, or workspace observer evidence before local optimistic state or peer replay can change shared desktop state.
- Win95 file-manager opens now preserve `win95_file_system` lifecycle provenance, and `.link` file opens emit source-specific browser navigation evidence instead of being flattened into generic desktop launches.
- Win95 browser reload and external-open clicks now emit source-backed browser navigation evidence, so repeated or blocked-site browsing remains synced and replayable across shared desktop sessions.
- Clippy/Devin bridge evidence now carries a hashed Devin API run reference through prompt handoffs, API responses, room actions, browser fallbacks, and source refs so real agent interactions remain joinable without exposing raw provider session ids.
- Clippy/Devin room-action suggestions now require explicit `agent_stdout` or `agent_api_response` bridge source metadata before rendering as executable desktop actions, preventing source-less action hints from implying real agent provenance.
- Clippy/Devin chat replies now require bridge-observed timestamps and persistence state before rendering as agent messages, preventing source-thin responses from being shown as real Devin output.
- Dev-container sessions now clear stale live error messages when the real container recovers to a non-error state, while preserving the original failure as immutable assessment evidence.
- Win95 peer cursor sharing now rate-limits raw pointer broadcasts while still preserving source-backed cursor evidence samples, reducing remote cursor rendering noise during live interviews.
- Blocked Clippy chat submits now stay typeable and persist replayable source-backed non-delivery evidence with exact prompt text, prompt fingerprint, and readiness reason instead of silently disabling the input or implying Devin received the message.
- Failed video-room recording stops now broadcast and persist source-backed browser failure stage/source/message facts, while vague failed recording states are rejected instead of entering the evidence graph.
- Candidate ingestion status now queues a source-backed retry for stale Workers AI model failures, so the challenge wait screen can recover from deprecated-model errors instead of replaying an old terminal failure.
- Clippy room-action routing now rejects unsupported bridge action shapes instead of relabeling legacy agent suggestions as human prompt actions, while still allowing file-change observations to offer a user-clicked workspace prompt.
- Clippy/Devin can now use a real Devin service-user API session from the dev-container bridge, preserving API replies and room-action suggestions as `agent_api_response` source-backed evidence instead of requiring CLI login or relabeling API output as stdout.
- Candidate dev-container launches now pass the real Devin bridge configuration into the server-side container init payload without returning secrets to the browser, keeping Clippy chat eligible for real-agent operation outside meeting-room launches.
- Dev-container expiry/manual teardown now marks intentional container stops before destroy, preventing normal `EXPIRED` sessions from retaining false "container stopped unexpectedly" diagnostics in UI and evidence projections.
- Clippy/Devin bridge diagnostics, auth/status messages, room-action text, and real stdout fallback evidence now redact service tokens, bearer tokens, room tokens, and secret query parameters before browser evidence, Durable Object broadcast/storage, or session-event persistence; secret-bearing agent chat is rejected instead of rewriting fingerprinted evidence.
- The container Clippy/Devin bridge now redacts real agent stdout and room-action text before WebSocket broadcast and direct `session-events` persistence, so bridge-origin evidence hashes the same redacted text as browser fallback evidence.
- Clippy/Devin bridge status and diagnostic events now emit direct exact-text `clippy_agent_status` / `clippy_agent_diagnostic` source refs in living-context and assessment evidence instead of only being citeable through the broad meeting-session packet.
- Workspace-state diagnostics now redact room tokens, Devin/Cognition tokens, API keys, bearer tokens, and secret query parameters in both browser-built evidence and the VideoRoom Durable Object activity log.
- Standalone dev-container launches now mark candidate sessions `ERROR` with a redacted diagnostic when the background Durable Object init request fails before the container can report status, and the status API returns that diagnostic to the UI.
- Room workspace launches now mark dev-container sessions `ERROR` with a redacted diagnostic when the background Durable Object init request fails before the container can report status, preventing broken workspaces from polling forever as `LAUNCHING`.
- The Win95 Clippy tray icon now reflects whether the Clippy chat panel is actually open, while keeping the tray entry available after prompt dismissal or chat close for the next real-agent interaction.
- Rejected shared Notepad/Paint file events now return the Durable Object's authoritative file snapshot so clients roll back optimistic file changes that were not accepted as source-backed evidence.
- Authoritative shared desktop snapshots now remove stale locally optimistic Win95 windows that are no longer accepted by the Durable Object while preserving local bootstrap call/chat/workspace windows, preventing rejected or missed close events from leaving one participant's desktop out of sync.
- Rejected shared desktop events now return the Durable Object's authoritative surface/window snapshot, allowing clients to roll back optimistic local 95/standard-call state when source-backed desktop evidence is refused.
- Reconnected room clients now re-apply the Durable Object's authoritative shared surface snapshot unless a fresh local surface toggle is still pending, keeping host and guest synced when one returns from 95 Until Infinity to the standard call after the other briefly disconnects.
- Transcript-derived assertion context records now preserve self-contained exact-text `source_span` refs with content hashes, segment locators, speaker roles, timestamps, provider confidence, and contact attribution so scored/person evidence can cite the spoken moment without reconstructing it from a broader transcript packet.
- Source-backed 95 room surface changes, Start menu toggles, browser navigation, window lifecycle/data/state updates, cursor samples, media controls, recording state, workspace state, and code-server opens now emit direct source refs and graph entities in living-context and assessment evidence instead of only the broad meeting-session event packet.
- Clippy UI actions and real bridge room-action suggestions now preserve direct `clippy_ui_action` / `clippy_agent_room_action` exact-text source refs in living-context and assessment evidence, so tray clicks, chat closes, auth intents, and agent suggestions are citeable without unpacking the broader room event packet.
- Room chat, proactive Clippy prompts, Clippy user prompts, and real agent stdout replies now preserve direct exact-text source refs in living-context and assessment evidence, so chat turns can be cited without unpacking the broader room event packet.
- Code-server file saves/deletes now preserve direct `code_server_file_observation` source refs in living-context and assessment evidence, keeping observed path/action/hash/size/preview/workspace provenance citeable without pretending the full file body was captured.
- Container terminal commands and output chunks now preserve direct `terminal_command` / `terminal_output` exact-text source refs in living-context and assessment evidence, so terminal activity can be cited without unpacking the broader room event packet.
- Win95 Paint saves/deletes now preserve exact canvas JSON as `room_file_content` source refs in both living-context and assessment evidence, without adding raw preview fields, so Paint activity is citeable from immutable source evidence instead of only a content hash.
- Win95 text-file changes now preserve exact Notepad content as `room_file_content` source refs in both living-context and assessment evidence, so file-change graph records can cite the original note text instead of only a preview/hash.
- Room chat evidence now fails closed unless Durable Object messages and replayed room activity carry browser chat source, stable message identity, actor, delivery status, surface, room phase, and exact message length, preventing forged chat claims from entering meeting-session evidence.
- Code-server file-change evidence now fails closed unless bridge metadata includes a real workspace session, observed timestamp, SHA-256 content hash, and size, preventing browser-only events that room replay would reject.
- Clippy workspace file-change observations now require code-server bridge source, observed timestamp, SHA-256 content hash, file size, and persistence state before rendering a workspace suggestion, preventing source-less agent messages from implying a real edit.
- Container terminal command/output evidence now fails closed until a real workspace session exists, preventing browser-only terminal events that the room Durable Object would reject from entering the context graph.
- Clippy chat now shows a live bridge readiness checklist for workspace, WebSocket, agent identity, state, and capabilities with distinct status dots, so disabled Devin chat is diagnosable without enabling fake or source-less messages.
- Host recording start/stop/upload state now syncs through the room Durable Object to both Win95 and standard layouts, with source-backed MediaRecorder provenance replayable into session evidence instead of remaining host-local UI state.
- Win95 room file saves now fail closed when source-backed file evidence cannot be built, preventing source-less Notepad/Paint mutations from becoming local room state.
- Win95 Start menu open/close now syncs between room participants and replays as source-backed `desktop_menu_toggle` evidence instead of staying local-only UI state.
- Win95 Start menu launches now persist `win95_start_menu` lifecycle/state evidence instead of being misattributed to desktop icon interactions.
- Win95 window state evidence now preserves whether focus/minimize/restore came from the taskbar, desktop icon, or window chrome instead of collapsing every update to window chrome.
- Clippy-opened Win95 tool windows now persist `window_open` lifecycle evidence with `lifecycleSource: clippy_action` instead of misattributing those opens to direct desktop UI clicks.
- Clippy’s Devin login terminal button now records `open-devin-auth-terminal` evidence instead of the generic `open-terminal` action id.
- Clippy’s browser-based Devin auth button now records `open-devin-auth-browser` evidence instead of collapsing the click into a CLI auth recheck.
- Room Chat’s paperclip launcher now records `clippy_chat_ui` provenance instead of misattributing the Clippy open action to the Win95 taskbar tray.
- Closing the Clippy chat window now only closes the chat panel and persists a source-backed `clippy_chat_ui` close action, keeping the Win95 tray Clippy entrypoint mounted for the next real-agent interaction.
- Clippy chat’s generic “Open Terminal” button now routes through source-backed `open-terminal` Clippy action evidence before opening the shared terminal window.
- Clippy “Check Devin auth” clicks now emit source-backed human UI action evidence before the bridge re-runs real Devin CLI auth preflight, keeping auth recovery intent separate from bridge diagnostics.
- Clippy auth-needed chat now includes a real “Check Devin auth” retry after terminal login, reusing the container bridge auth preflight so Devin only becomes ready after the CLI reports a stored login.
- Summary-only meeting transcript analysis now strips model-produced semantic assertions from stored analysis JSON and records suppression metadata, preventing mixed-audio transcripts from leaving candidate-shaped claims outside the source-backed ingestion gate.
- Clippy auth-needed chat now opens the real container terminal and queues `devin auth login --force-manual-token-flow` for the user, while terminal evidence redacts auth tokens before commands/output are persisted.
- Clippy/Devin now preflights real `devin auth status` before starting the CLI, treats service API keys as insufficient for CLI login, surfaces precise auth-needed diagnostics, and shows the live agent state on the Win95 tray icon beside the clock.
- Clippy/Devin bridge readiness now requires an actual Devin CLI executable in the dev-container image, passes optional `DEVIN_ORG_ID` into room-scoped containers, and emits real missing-CLI/auth-needed diagnostics instead of reporting `AGENT_READY` when Devin is absent or login is canceled.
- Dev-container Durable Object lifecycle hooks now persist source-backed `SLEEPING`, wake-to-`READY`, and unexpected-stop/error diagnostics, keeping Clippy availability and workspace evidence aligned with the real container state.
- Sampled Win95 peer-cursor movements now publish source-backed cursor evidence through the room Durable Object, while raw pointer moves stay live-only and are excluded from replay.
- Room-end Durable Object replay now maps accepted mic/camera control activity into source-backed `media_control` meeting-session evidence, instead of relying only on one browser's direct event capture.
- Mic/camera toggles now publish source-backed shared media-control events through the room Durable Object, persist replayable activity/state, and render peer media status across both standard and Windows 95 room surfaces.
- Room chat delivery acknowledgements and rejections now persist as source-backed `chat_message` evidence immediately, so the live context graph records the Durable Object delivery outcome instead of only the optimistic browser send.
- Dev-container agent startup now requires an explicit supported `AGENT_TYPE` through the meeting launch path and bridge runtime instead of defaulting missing or unsupported agent configuration to Devin.
- Clippy chat UI now waits for an explicit container bridge agent identity before enabling chat or naming Devin, preventing the room surface from visually implying a fake agent is connected.
- Browser-side Clippy/Devin evidence builders now fail closed when bridge agent identity is missing, preventing room clients from defaulting source-less fallback/status evidence to `devin`.
- Clippy/Devin container diagnostics now fail closed when agent identity is missing, preventing the bridge helper from fabricating `devin` on source-less diagnostics, chat responses, or room-action evidence.
- Clippy/Devin agent replies and room-action suggestions now expose normalized browser prompt correlation refs in meeting-session context records and compact agent context summaries, so rebuildable hypergraph projections can join prompt, response, and action evidence without guessing.
- Clippy/Devin browser prompt correlation refs are now validated across HTTP session ingestion, Durable Object room sync, and replay projections, rejecting malformed agent-output/action evidence instead of accepting loose prompt-link JSON.
- Real Clippy/Devin stdout responses and room-action suggestions now preserve the browser prompt id that caused the bridge handoff, letting the hypergraph join user chat, stdin delivery diagnostics, agent output, and executed actions without guessing.
- Clippy CHAT frames now carry a stable browser prompt id into the real dev-container bridge, and bridge handoff diagnostics preserve the same prompt reference after stdin delivery attempts for source-backed hypergraph correlation.
- Clippy user prompt evidence now distinguishes browser-queued CHAT frames from confirmed bridge delivery, and HTTP, Durable Object, and replay validators reject stale prompt evidence that claims bridge delivery.
- Clippy/Devin container bridge diagnostics now redact bare Cognition/Devin service-token strings before they can appear in chat, session events, or hypergraph evidence.
- Clippy user-prompt evidence now records browser-to-bridge CHAT submission without Devin attribution, and HTTP, Durable Object, and replay validators reject human prompts that stamp an agent identity.
- 95 room assessment evidence now preserves explicit Clippy/Devin bridge agent identity from `agent`/`agentName` metadata and leaves missing agent ids absent instead of defaulting assessment actors to Devin.
- Clippy UI action evidence from tray and prompt clicks now rejects any agent attribution server-side, keeping human Clippy interactions separate from real Devin bridge evidence.
- Clippy/Devin bridge room-action validators now require the exact stdout tag source and `clippy_room_action_tag` protocol across HTTP session events, Durable Object replay, graph replay, and the container bridge helper instead of accepting generic bridge-shaped action strings.
- Clippy prompt/tray actions no longer stamp Devin as the acting agent, and browser-executed Devin desktop actions now require source-backed `ROOM_ACTION` bridge metadata before executing or persisting.
- Clippy/Devin browser bridge parsing now ignores `CHAT_RESPONSE` and `ROOM_ACTION` packets without explicit bridge-provided agent identity instead of defaulting them to Devin.
- Meeting recording uploads now require explicit speaker-channel metadata before separate transcription audio can produce attributed transcript evidence; missing metadata stays summary-only instead of defaulting channel 0/1 to host/guest.
- Clippy/Devin room context summaries now include compact source refs for each session event, preserving candidate node ids, session refs, captured timestamps, and stable event ids inside the real Devin prompt context.
- Code-server save/delete observations from the real Clippy/Devin bridge now publish into a source-validated shared room activity log for replayable context-graph sync instead of existing only in one browser's direct session-event queue.
- Clippy/Devin user prompts, bridge status/replies, and room-action executions now publish into a source-validated shared room activity log for replayable context-graph sync instead of existing only in one browser's direct session-event queue.
- Container terminal command/output events now publish into the shared room Durable Object, replay into context graph sync, and reject source-less terminal claims instead of relying only on one browser's direct session-event POST.
- Meeting transcript processing failures now append immutable assessment diagnostics with exact recording/transcription source keys and error provenance instead of living only in the mutable meeting row.
- 95 Until Infinity room session evidence now stores the full stable browser/bridge event packet as the immutable `meeting_session_event` source text instead of reducing source refs to display text.
- Dev-container lifecycle rows now append immutable assessment evidence for launch, ready, warning, error, stop, and expiry transitions, preserving the exact D1 session snapshot instead of relying only on browser-observed workspace state.
- Meeting transcript ingestion now mirrors each canonical transcript source span into immutable assessment evidence, preserving speaker attribution, recording keys, source span ids, exact text, and hashes without creating source-less evaluation claims.
- Meeting-room session events, including Clippy/Devin interactions, now append exact-source immutable `NINETY_FIVE_UNTIL_INFINITY_ROOM` assessment evidence events alongside candidate/context projections.
- Clippy/Devin bridge readiness now marks a real container agent ready after it accepts the source-backed room-context primer, so quiet Devin CLI starts do not leave Clippy chat permanently disabled, and raw chat bridge packets now include explicit `agent_stdout` provenance.
- Clippy/Devin bridge status and browser agent evidence now require explicit bridge-provided agent identity instead of defaulting source-less status/messages to `devin`.
- Browser-observed Clippy/Devin agent messages now require explicit bridge source metadata before becoming agent chat/status evidence instead of defaulting source-less messages to bridge diagnostics.
- Browser-observed Devin/code-server file changes now require explicit `code_server_workspace` bridge source metadata before becoming save/delete evidence instead of defaulting missing source fields.
- Proactive Clippy prompts without browser prompt evidence are now rejected by the room Durable Object and skipped during replay instead of gaining Durable Object fallback provenance.
- Workspace/dev-container state without browser observer evidence is now rejected by the room Durable Object and skipped during replay instead of gaining Durable Object fallback provenance.
- Clippy UI and agent room-action evidence now carries stable action ids and capture timestamps across tray, prompt, browser-executed, and persisted bridge suggestion paths.
- Clippy/Devin agent reply evidence now carries stable CHAT_RESPONSE ids, capture timestamps, response fingerprints, and lengths across browser fallback and persisted bridge paths.
- Clippy/Devin agent status evidence now carries stable bridge status ids and capture timestamps across browser-observed states and persisted container diagnostics.
- Workspace-state evidence now carries actor-bound observer ids and capture timestamps through Durable Object replay, normalizes room replay ids, and preserves that source context before becoming meeting-session context.
- Code-server iframe open evidence now carries actor-bound open ids and capture timestamps before entering meeting-session context.
- Container terminal command/output evidence now carries actor-bound capture ids and timestamps so repeated same-command interactions remain distinct source events.
- Synced Win95 Notepad/Paint saves and deletes now carry actor-bound file-change ids, capture timestamps, and browser file evidence through Durable Object replay.
- Shared Win95 file-system events without browser source evidence are now rejected by the room Durable Object and skipped during replay instead of becoming source-less `file_change` graph nodes.
- Shared Win95 window open/navigation/data/state events without browser source evidence are now rejected by the room Durable Object and skipped during replay instead of gaining Durable Object fallback provenance.
- Shared room surface changes without browser-toggle source evidence are now rejected by the room Durable Object and skipped during replay instead of gaining `room_surface_durable_object` fallback provenance.
- Workers AI model routing now remaps deprecated Llama 3.1 8B variants before inference so repo/challenge discovery does not fail on stale environment overrides.
- Synced Notepad/Paint window-data updates now carry stable window-data ids, capture timestamps, changed keys, and value fingerprints through shared desktop state, Durable Object replay, and session-event validation.
- Synced Microsoft Edge navigations now carry stable browser navigation ids, capture timestamps, and URL fingerprints through shared desktop state, Durable Object replay, and session-event validation.
- Synced Win95 window lifecycle/state events now preserve stable window event ids and capture timestamps through the client connection, Durable Object replay, and session-event validation.
- Summary-only room transcripts now persist their person-context mode into living-context metadata and cannot create candidate source attributions, assertions, or signals.
- Clippy/Devin agent reply evidence now requires real `CHAT_RESPONSE` provenance, persisted bridge metadata or explicit browser fallback metadata, and rejects bridge-shaped replies without those source facts.
- Clippy/Devin agent status evidence now requires bridge provenance, observed timestamps, and either browser WebSocket context or persisted bridge diagnostics before entering the meeting-session graph.
- Participant join/leave evidence now requires meeting-room lifecycle route provenance with observed timestamps and matching host/guest roles before entering the meeting-session graph.
- Clippy prompt evidence now preserves browser proactive prompt triggers, room/workspace context, and explicit no-agent-response provenance through Durable Object replay, while rejecting source-less direct prompt claims.
- Workspace-state evidence now separates browser observer provenance from launch/refresh/error lifecycle source, preserves that metadata through Durable Object replay, and rejects source-less direct workspace-state claims.
- Code-server editor-open evidence now requires browser iframe load provenance, workspace session context, and an explicit no-proxy-URL persistence marker before entering the meeting-session graph.
- Recording start/stop evidence now requires host browser MediaRecorder provenance, lifecycle kind, speaker-channel metadata, and upload source facts before entering the meeting-session graph.
- Clippy/Devin user prompts now require source-backed browser chat evidence with bridge delivery, prompt ids, fingerprints, lengths, and workspace context before entering the meeting-session graph.
- Clippy action evidence now rejects source-less action claims and requires either source-backed tray/prompt UI metadata or real Devin bridge `ROOM_ACTION` provenance before entering the meeting-session graph.
- 95 Until Infinity room chat browser submissions now use source-backed chat evidence with shared-room message ids, client ids, delivery status, message timing, surface, and room phase before entering the meeting-session graph.
- 95 Until Infinity terminal command/output evidence now requires browser terminal WebSocket provenance, deterministic command/output ids, fingerprints, lengths, and workspace context before entering the meeting-session graph.
- Win95 window open/close and state updates now require source-backed lifecycle/state metadata before entering meeting-session evidence, and already-open desktop icon clicks sync focus/restore actions across both screens.
- Standalone code-review assessment routing now ignores room lifecycle telemetry when deciding whether candidate decomposition evidence exists, sends telemetry-only candidates back to CV intake, and replaces claimed invite tokens before emailing assessment links again.
- Clippy/Devin agent replies now require real bridge `CHAT_RESPONSE` source metadata before becoming `ai_chat_agent` evidence; source-less browser claims are rejected as invalid session events.
- Video-room clients now rely on the source-backed lifecycle route for participant join/leave evidence and stop retrying permanent session-event validation failures forever.
- Code-server save/delete evidence now requires FILE_CHANGED bridge provenance, content hash, size, observation time, and either direct container persistence or browser-fallback room/workspace context before entering the graph.
- Shared room surface changes now carry browser-toggle provenance, stable surface-change ids, timestamps, previous/next surfaces, and Durable Object replay markers across live capture and replayed projections.
- Win95 cursor presence evidence now includes actor-bound sample ids, browser pointermove provenance, timestamps, sampling thresholds, and previous-position deltas before the API accepts it.
- Video room microphone/camera evidence now includes actor-bound event ids, browser control provenance, capture timestamps, and previous/next state before the API accepts it.
- Win95 shared cursor presence now records sampled source-backed `cursor_presence` evidence instead of keeping the mouse layer as live-only state.
- Win95 shared cursor presence now renders peer cursors relative to the desktop overlay instead of viewport units, preventing host/guest pointer trails from drifting across nested room surfaces.
- Room Chat now exposes a Win95 paperclip launcher for the existing real Clippy/Devin panel without rerouting human chat or fabricating assistant replies.
- Durable room-chat replay now preserves accepted delivery status and browser-source provenance before projecting chat into meeting-session evidence.
- Video room microphone/camera toggles now persist as validated source-backed `media_control` evidence with surface and room phase metadata.
- Win95 Notepad/Paint saves and deletes now submit validated source-backed `file_change` evidence immediately with file identity, content hashes, and delete snapshots.
- Microsoft Edge navigation now submits validated source-backed `browser_navigation` evidence with normalized URL, trigger, host, surface, and room phase metadata.
- Code-server workspace creates/modifies now persist as source-backed `code_editor_save` evidence with bridge source metadata and content hashes, while deletes remain `file_change` evidence.
- Meeting-session event replay now keys evidence on stable event properties, preserving distinct repeated Win95 interactions such as multiple browser/window moves while keeping Durable Object replays idempotent.
- Session-event route coverage now proves browser-submitted client event ids preserve distinct repeated same-second Win95 interactions while retrying the same client event remains idempotent.
- Browser-submitted meeting-session evidence now includes stable client event ids and capture times, so repeated same-second Win95 interactions remain distinct while retries keep the same source identity.
- The VideoRoom Durable Object now lets host and guest participants switch the shared room surface, so returning from 95 Until Infinity to the standard call syncs both screens instead of rejecting guest surface changes.
- Clippy/Devin chat now opens from a Win95 taskbar tray paperclip beside the clock even before the workspace is ready, clearly distinguishes real Devin availability from Room Chat, and lets users restore Clippy after dismissing the prompt.
- The video-room package now owns its Clippy/Win95 component test harness, preventing duplicate React renderers from invalidating the real-agent chat and taskbar tray tests.
- Opening Clippy from the Win95 tray and dismissing the Clippy prompt now emit source-backed `clippy_action` evidence as human UI actions without claiming a Devin response.
- Video-room session evidence now requeues non-OK API writes and drains queued events with Beacon/keepalive on page unload so short-lived Win95 interactions are less likely to disappear before persistence.
- The session-events API now accepts Beacon-style `text/plain` JSON and returns non-OK when persistence fails, letting the room client retry instead of dropping uncaptured evidence.
- Win95 window focus, minimize, restore, maximize, and move interactions now submit immediate `window_update` evidence with the exact state patch while still syncing through the shared desktop Durable Object.
- Dev-container workspace launches now pass the Worker `DEVIN_API_KEY` secret into the container as server-side init data for the real Clippy/Devin bridge without exposing the key in candidate-facing room responses.
- The Clippy/Devin bridge now persists an `auth_required` agent diagnostic as soon as it observes missing real Devin credentials, instead of waiting for a candidate chat attempt before creating source-backed evidence.
- The Clippy/Devin bridge now reports a real `starting` state, waits for observed non-auth Devin output before enabling chat, times out missing readiness as a source-backed diagnostic, and classifies Devin auth/login output as source-backed auth diagnostics instead of fake agent replies.
- Matched-repo dev workspaces now surface an explicit `missing_reviewable_task` diagnostic when no PR/task is assigned, and room desktop evidence preserves that setup gap instead of treating a repo-only launch as a completed assessment challenge.
- Scheduling now returns and displays a rebuildable assessment setup projection for workspace-backed invites, distinguishing concrete PR tasks from missing reviewable tasks and contact-first invites waiting for source-backed candidate evidence.
- Contact-first invite living-context artifacts now preserve assessment setup diagnostics in exact source text and qualifiers, so missing candidate evidence or missing PR tasks remain source-backed instead of UI-only state.
- Upgraded shared Paint into a canvas-style diagram board with pencil, rectangle, diamond, arrow, pan, zoom, reset-view, and synced durable `.pipe-paint` saves while preserving existing freehand drawings.
- Microsoft Edge now detects common sites that block iframe embedding, including Google, and shows an external-open fallback instead of a blank white page.
- Microsoft Edge back/forward navigation now syncs through the shared desktop and emits `browser_navigation` evidence instead of staying local to one participant.

### Added — 95 Until Infinity repo-task assessment contract

- Added the proposed source-backed repo-task assessment contract for `DEV_CONTAINER_REPO_TASK` and `OPEN_SOURCE_BUG_FIX`, including candidate evidence packets, repo task packets, match diagnostics, AI usage evidence, and final evaluation output types.
- Documented the 95 Until Infinity repo-task matching plan, preserving the Evidence Hypergraph requirements that no positive match or evaluation claim can exist without source refs.
- Tightened the repo-task final assessment output into evaluated vs diagnostic states so successful evaluations require source-backed submission/evaluation evidence and non-success states require explicit diagnostics.
- Added a final repo-task submission bundle route that records candidate plans, diagrams, messages, terminal output, test runs, code diffs, AI interactions, tool usage, transcript spans, and final explanation as immutable source-backed assessment events before marking the session `FINAL_SUBMITTED`.
- Added `OPEN_SOURCE_BUG_FIX` as a workspace-backed assessment interview mode for scheduling, invite creation, dev-container launch, and candidate assessment routing.
- Added the canonical assessment-layer persistence spine with assessment sessions, immutable source-backed evidence events, state transitions, evaluation reports, diagnostics, and a repo-task compatibility projection for later `OPEN_SOURCE_BUG_FIX`/dev-container assessment routes.
- Added the repo-task assessment session facade and focused API route tests for creating sessions, appending exact-source evidence events, transitioning state, rejecting unsupported positive claims, recording AI-unavailable diagnostics, and projecting assessment evidence into context records.
- Assessment evaluation reports now reject positive claims whose cited source refs were not previously captured as immutable evidence events in the same assessment session.
- Completed scored CODE_REVIEW sessions now write exact-source transcript and score-report events plus an evaluated assessment report into the assessment evidence spine with idempotent state transitions.
- 95 Until Infinity room lifecycle now replays Durable Object desktop/chat/file activity into source-backed meeting-session evidence when the host ends the room, instead of waiting for a later context-graph read.
- 95 Until Infinity room chat now persists as first-class `chat_message` evidence instead of being mislabeled as Clippy/Devin `ai_chat_user` input.
- 95 Until Infinity room chat now reconciles optimistic local sends with Durable Object ACK/rejection messages, so browser evidence marks client submissions as pending while the shared room log remains the authoritative accepted-chat source.
- 95 Until Infinity shared Notepad/Paint file replay now adds deterministic content hashes to `file_change` evidence, so desktop-created files have immutable provenance beyond previews.
- 95 Until Infinity shared file deletes now enrich the Durable Object activity log with the deleted file snapshot when available, letting replay evidence preserve deleted file name, kind, content hash, and bounded preview.
- 95 Until Infinity room activity replay now captures synced window state changes such as focus, minimize, maximize, and movement as source-backed `window_update` meeting-session evidence.
- 95 Until Infinity room lifecycle now captures accepted guest join/leave and recording start/stop events as source-backed meeting-session evidence, without fabricating a recording stop when no recording was active.
- 95 Until Infinity recording transcripts now persist per-segment speaker-channel metadata and attribution-source metadata, so host/guest transcript evidence can explain the stream/channel mapping used for speaker roles.
- 95 Until Infinity browser recording lifecycle events now include the real speaker-channel map, ICE provider, media MIME types, and captured byte counts, and host-end auto-stop uses the same source-backed event path as manual stop.
- Host and guest participants can now both switch the shared room between standard call and 95 Until Infinity, with browser-side `room_surface_change` evidence recording the actor, previous surface, next surface, and room phase.
- The video-room dev smoke now verifies the intended standard-call landing state before launching 95 Until Infinity and confirming that both participants sync into the desktop.
- 95 Until Infinity terminal windows now capture completed container commands and bounded terminal output chunks as source-backed meeting-session evidence with workspace/session metadata.
- 95 Until Infinity terminal evidence now links bounded output chunks back to the completed command being run with terminal session ids, command/output sequence ids, and deterministic text fingerprints.
- 95 Until Infinity now captures a deduplicated `code_editor_open` evidence event when the VS Code/code-server workspace iframe actually loads, without persisting room-token proxy URLs.
- 95 Until Infinity workspace state events now preserve source-backed dev-container diagnostics, including session id, status, repo context, TTL, and error message, without persisting room-token proxy paths.
- Clippy/Devin bridge status transitions now persist as source-backed meeting-session evidence, including real auth-required/disconnected states instead of simulated agent availability.
- Clippy/Devin chat evidence now distinguishes real Devin stdout from bridge diagnostics and file-watcher observations, so auth-required and container-observed events are not recorded as fabricated Devin replies.
- Clippy/Devin room actions now preserve their origin, bridge event type, action protocol, agent name, execution role, and stdout-tag source in `clippy_action` evidence, distinguishing real Devin-driven desktop actions from local prompt-button nudges.
- Clippy/Devin process diagnostics now broadcast bounded, redacted stderr, context-primer failures, process exits, and startup errors into `ai_agent_status` evidence with diagnostic source, observed time, exit code, and signal metadata.
- Clippy/Devin prompt handoffs now persist bridge diagnostics for real context-primer and chat-prompt delivery into Devin stdin, including delivery status, context status, and redacted fingerprints/lengths without storing raw prompt text.
- Clippy/Devin bridge diagnostics, prompt handoffs, and real Devin stdout now post token-scoped `session-events` directly from the dev container before broadcasting to browsers, with browser fallback only when bridge persistence fails.
- Clippy/Devin room-action suggestions now persist directly from the bridge as source-backed `clippy_action` suggestion events, while browser execution evidence links back to the persisted suggestion metadata.
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
- Workspace-backed assessment emails now always deliver fresh `/assess/:token` links for CODE_REVIEW, DEV_CONTAINER_CHALLENGE, and OPEN_SOURCE_BUG_FIX invites, even if stale scheduling URLs exist on the interview row.
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

### Added — 95 Until Infinity shared interview desktop

- The video room now uses the synced Win95 desktop as the durable interview shell, with the standard call layout preserved as a host-switchable fallback surface.
- Added synced desktop surface/window events through the `VideoRoom` Durable Object, covering shared Edge, Notepad, Paint, terminal, window close/data updates, and host-controlled room-surface changes.
- Added an append-only desktop activity log in the `VideoRoom` Durable Object so shared desktop interactions can be replayed and promoted into living-context evidence.
- Added regressions for workspace launch gating, host-controlled desktop surface changes, and shared desktop window sync.
- Updated the deployed video-room smoke to validate the Win95 desktop surface and recording taskbar state instead of the legacy standard-call badges.
- Added a proactive Clippy prompt card with room actions for starting recording, launching/opening the workspace, and opening the terminal, with `clippy_action` session evidence capture.
- Added recruiter room-status SSE updates so guest-waiting/live room state patches the scheduling dashboard without the old 10-second client polling loop.
- Added shared Clippy prompt events to the video-room Durable Object so proactive assistant guidance is persisted, replayable, and synced across host/guest desktops.
- Added a shared Win95 room filesystem with durable file snapshots, activity logging, Notepad/Paint autosave, and a synced Files window for opening or deleting shared desktop files.
- Added a safe Clippy/Devin room-action protocol so the dev-container agent bridge can suggest or execute allow-listed desktop actions such as opening Terminal, Files, Notepad, Paint, Browser, and Workspace.
- Standard video rooms now initialize on the modern call surface, while dev-container challenge rooms initialize directly into the synced 95 desktop and hosts can still switch surfaces during the call.
- Fixed shared Paint so long strokes are previewed at a controlled cadence and durably committed on pointer release, preventing remote participants from getting stranded on partial drawings.
- Fixed the Win95 terminal protocol so resize/control messages are not sent to bash as typed text, restoring an interactive container prompt after connect.
- Added a host stop-recording control that uploads the recording while keeping the call connected, instead of requiring hosts to end the call to stop recording.
- Fixed a room-surface sync race so a host-triggered switch into 95 mode is not overwritten by an older standard-room snapshot.
- Renamed the Win95 code workspace affordance from "My Computer" to "VS Code" so candidates see the actual container editor.
- Added durable synced room chat and live peer cursors to the shared 95 desktop so host and guest can see each other's messages, pointer presence, and desktop actions.
- Added server-side replay from the `VideoRoom` Durable Object activity log into candidate session evidence so synced room surface, workspace, chat, Clippy prompt, and shared file actions are idempotently available in the context graph.
- Restored dev-container workspace startup by keeping VS Code/code-server on port 8080 and routing the Devin/Clippy bridge through sidecar port 8081.
- Fixed peer cursor trails by merging remote cursor presence into one receive-timestamped cursor per role and rendering it with transform-only composited SVG pointer movement.
- Added a shared-surface regression so host "Return to Call" moves both host and guest back to the standard call layout.
- Removed the oversized dynamic Devin bridge script from container startup so VS Code/code-server can boot through the image entrypoint without hitting Cloudflare runtime value limits.
- Added the Devin/Clippy bridge/router to the dev-container image so agent startup no longer depends on a large Worker-provided entrypoint.
- Fixed the workspace proxy root route so the code-server iframe can load the bare session proxy URL.
- Added a shared-room workspace state sync event so a host-launched dev workspace appears on the guest's 95 desktop.
- Added research tasks for the remote OS-agent protocol decision and stream-backed transcript speaker attribution.
- Recording uploads now include validated speaker-channel metadata, persist it with transcript artifacts, and use it for Deepgram segment attribution before promoting transcript evidence into the living context graph.
- Tightened standalone CODE_REVIEW RPC coverage so malformed source-backed packet diffs stay in `WAITING_FOR_MATCH` instead of falling through the dev-container challenge branch.
- The Devin/Clippy container bridge `/context` endpoint now fetches the source-backed room context summary through a token-scoped API route so the assistant can read captured interview evidence without browser dev-auth cookies.
- Devin is now primed with the latest source-backed room context and the safe shared-desktop `[[room_action:*]]` protocol when Clippy starts or forwards chat into the dev-container agent.
- Clippy/Devin chat prompts and agent replies are now captured as source-marked meeting-session evidence so assistant guidance becomes part of the living context graph.
- Shared Win95 windows now persist and replay geometry, focus, minimized, and maximized state so host window movement/state changes converge on the guest desktop.
- Added an explicit "Ask Clippy" control to the Win95 room so candidates can open the Devin-backed Clippy chat without relying on the animated paperclip click target.
- Removed the unauthenticated Devin auth bypass and local Clippy room-action replies so Clippy only chats and drives the shared desktop through a real Devin process.

### Changed — Win95-themed workspace overlay in video room

- Replaced the always-visible workspace panel with a toggleable floating icon button in the video room.
- Workspace panel now uses React95 `Window` components with a custom PIPE-infused Win95 theme (dark navy header, teal `#008080` desktop background, Lucide icons preserved).
- Added `workspaceOpen` state so the panel is closed by default; host clicks the terminal icon to open it.
- Window header shows repo URL with a close button; empty state uses classic Win95 teal desktop background.
- Installed `react95` and `styled-components` in the video-room app.

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
