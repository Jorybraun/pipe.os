# PIPE-OS MVP UI Simplification Coordination

Date: 2026-06-19
Owner: Codex

Current implementation pass:

- Make Interviews the default home surface.
- Keep existing pipeline/stage internals, but expose them as Role/Round in the UI.
- Add clean route aliases: `/interviews`, `/roles`, `/people`, `/clients`.
- Keep legacy `/pipeline/*` routes working.
- Promote roleless interview creation from the Interviews dashboard.
- Fix scheduling creation so nullable role/round IDs work instead of forcing a pipeline lookup.
- Split existing Contacts UI into People and Clients views over the current contacts API.

Do not collide with:

- Living context graph/context-record work.
- Repo ingestion or candidate-to-PR matcher work.
- Knowledge/archive cleanup.

Important invariant:

- No fabricated semantic data, no fake skills/signals/edges, and no default match evidence. This pass is UI/API plumbing only.
