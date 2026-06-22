SUPERSEDED_BY: commit 977e339af (2026-05-15) — Neo4j graph-native matching implemented.
See: workers/api/src/lib/neo4j/, infra/neo4j/, docs/decisions/current/ADR-043*.md

# Neo4j: VPS Provisioning and Infrastructure Setup

**Source:** knowledge/plan/archive/superseded-strategy-v2-2026-06-19/pipe-strategy-v2-part5-matching-migration.md (lines 309–318)
**Phase:** 2 (after Phase 0 consumption cutover and Phase 1 candidate decomposition)
**Status:** PENDING
**Estimate:** 1 week (one-time setup ~8h, ongoing ~2h/month)

## Source quote

> Self-hosted Neo4j Community Edition on a Linux VPS. DigitalOcean or Hetzner. 4–8 GB RAM, 2 vCPU. Costs €10–40/month depending on provider and region.
> Ubuntu LTS, Neo4j Community 5.x. Caddy reverse proxy for automatic TLS. Bolt protocol (port 7687) exposed only to Cloudflare IP ranges via firewall.
> `neo4j-admin dump` daily cron, dumps piped to R2 or S3 with 30-day retention. Snapshot the VPS weekly.

## Why

Neo4j Community on a VPS is the cheapest way to get native graph traversal and vector similarity in one query engine. Self-hosting eliminates the per-query cost of managed graph services and keeps data under direct control. Caddy handles TLS renewal automatically; Cloudflare IP allowlisting means Bolt is never exposed to the public internet.

## Subtasks (delegable)

### Subtask 1 — VPS provisioning and OS hardening
**Files:**
- `infra/neo4j/provision.sh` (new — idempotent setup script)

**Spec:**
- Target: Hetzner CX22 (4 GB RAM, 2 vCPU, ~€4.15/month) or DigitalOcean 4 GB Droplet.
- Ubuntu 24.04 LTS.
- OS hardening steps in script:
  - Create non-root user `pipe` with sudo.
  - Disable root SSH, enable key-only auth.
  - `ufw` firewall: allow SSH (port 22) from admin IP only, allow Bolt (7687) from Cloudflare IP ranges only, allow HTTPS (443) for Caddy.
  - Install unattended-upgrades for security patches.
- Script is idempotent: re-running is safe (check-before-install pattern).
- Document Cloudflare IP ranges update procedure (quarterly, update ufw rules).

**Status:** ⏳ PENDING

### Subtask 2 — Neo4j Community 5.x installation + Caddy TLS
**Files:**
- `infra/neo4j/install-neo4j.sh` (new)
- `infra/neo4j/Caddyfile` (new)

**Spec:**
- Install Neo4j Community 5.x from official APT repository.
- Configure `neo4j.conf`:
  - `server.bolt.listen_address=0.0.0.0:7687`
  - `server.http.enabled=false` (Bolt-only, no HTTP API exposed)
  - `server.memory.heap.initial_size=1g`, `server.memory.heap.max_size=3g` (for 4 GB VPS)
  - `server.memory.pagecache.size=1g`
- Caddy reverse proxy for HTTPS:
  - `neo4j.<domain>` → proxy to local HTTP dashboard (internal monitoring only, not exposed publicly).
  - Bolt does not go through Caddy — it's a direct TCP connection.
- Set initial Neo4j password via environment variable (store in Cloudflare Worker secret / CI secret, not in script).
- Enable and start `neo4j` systemd service.

**Status:** ⏳ PENDING

### Subtask 3 — Backup cron: daily `neo4j-admin dump` to R2
**Files:**
- `infra/neo4j/backup.sh` (new)
- `infra/neo4j/backup.cron` (new — crontab entry)

**Spec:**
- Daily at 02:00 UTC: run `neo4j-admin database dump neo4j --to-path=/tmp/neo4j-backup`.
- Compress with `gzip`.
- Upload to Cloudflare R2 bucket `pipe-neo4j-backups/YYYY/MM/DD/neo4j.dump.gz` using `rclone` (configured with R2 credentials).
- Retain 30 days: delete dumps older than 30 days from R2.
- Weekly VPS snapshot via provider API (DigitalOcean API or Hetzner API script).
- UptimeRobot HTTP check on the Caddy HTTPS endpoint for external liveness (free tier sufficient).
- Email alert on backup failure (use Resend via a lightweight curl webhook).

**Status:** ⏳ PENDING

## Dependencies

- Blocks: `neo4j-driver-and-binding.md` (driver needs a running Neo4j instance to connect to)
- Blocks: all other Neo4j plan files

## Acceptance criteria

- [ ] Neo4j 5.x running on VPS, reachable on port 7687 from Cloudflare IP ranges
- [ ] Port 7687 blocked to all non-Cloudflare IPs via ufw
- [ ] TLS provisioned via Caddy for HTTPS dashboard access
- [ ] Daily backup cron runs, uploads to R2, deletes >30-day dumps
- [ ] UptimeRobot monitoring active
- [ ] Backup restore tested: dump restores cleanly to a fresh Neo4j instance
