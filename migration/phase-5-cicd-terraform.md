# Phase 5: CI/CD + Terraform + Cleanup

## 1. Overview

Phase 5 replaces Amplify's implicit CI/CD pipeline with explicit, deterministic infrastructure:

- **Terraform** manages all Cloudflare resources (D1, R2, Workers, Pages, DNS) and third-party integrations (Clerk, Resend domain verification).
- **GitHub Actions** handles preview deployments on PR, production deployments on merge, Terraform plan/apply, database migrations, and BDD tests.
- **Wrangler** replaces `npx ampx sandbox` for local development.
- The `amplify/` directory, `amplify_outputs.json`, and all AWS SDK dependencies are deleted.
- The existing `infra/` directory (ECS/ALB/networking) is archived — those resources are post-MVP (Fly.io replaces ECS).

> **Configuration format:** Use `wrangler.jsonc` (not `wrangler.toml`) for all Wrangler configuration. Cloudflare recommends `.jsonc` for better documentation support and comment syntax. All references to `wrangler.toml` in this plan should be implemented as `wrangler.jsonc`.

This phase produces zero Amplify artifacts. Every deployment is reproducible from a clean git checkout + `terraform apply` + `wrangler deploy`.

---

## 2. BDD User Journeys

### 2.1 Developer pushes to feature branch and gets preview deployment

```gherkin
Given a developer has pushed commits to branch "feat/new-scoring"
When the GitHub Actions "preview" workflow runs
Then Cloudflare Pages deploys a preview build at a unique URL
And the Workers API deploys to a preview namespace bound to a preview D1 database
And the preview URL is posted as a comment on the pull request
And the preview D1 database has all migrations applied
```

### 2.2 Developer merges PR to main and production deploys automatically

```gherkin
Given the pull request for "feat/new-scoring" is approved
When the developer merges to main
Then the "production-deploy" workflow runs
And Terraform applies any infrastructure changes
And D1 migrations run against the production database
And the Workers API deploys to the production namespace
And Cloudflare Pages deploys the frontend to pipe.dev
And the deployment completes in under 5 minutes
```

### 2.3 Developer runs terraform plan and sees exactly what will change

```gherkin
Given a developer opens a pull request that modifies terraform/
When the "terraform-plan" workflow runs
Then a terraform plan is generated against the production state
And the plan output is posted as a PR comment
And no resources are created, modified, or destroyed
And the workflow fails if the plan contains errors
```

### 2.4 Developer rolls back a bad deployment

```gherkin
Given a production deployment introduced a regression
When the developer reverts the merge commit and pushes to main
Then the production-deploy workflow runs with the previous code
And Cloudflare Pages serves the previous frontend build
And Workers deploy the previous API code
And D1 migrations are idempotent (no rollback needed for additive-only migrations)
And the rollback completes in under 3 minutes
```

### 2.5 New developer clones repo and runs locally in under 5 minutes

```gherkin
Given a developer has cloned the repository
And they have Node 18+, Wrangler CLI, and Terraform installed
When they run "npm install && npm run dev"
Then Vite serves the frontend at localhost:5173
And Wrangler runs the Workers API at localhost:8787
And a local D1 SQLite database is created automatically
And no AWS credentials, Amplify CLI, or cloud sandbox are required
```

### 2.6 Secrets are managed securely, never in git

```gherkin
Given the project requires API keys for Clerk, Resend, and AI providers
When a developer needs to add or rotate a secret
Then they update the secret in GitHub Actions encrypted secrets
And Wrangler secrets are set via "wrangler secret put" (never in wrangler.toml)
And Terraform reads sensitive values from environment variables (TF_VAR_*)
And .env.local is gitignored and contains only non-secret local overrides
And no secret value exists in any committed file
```

### 2.7 Database migrations run automatically on deploy

```gherkin
Given a developer has added a new file to migrations/
When the production-deploy workflow runs
Then the D1 migration runner applies all unapplied migrations in order
And the migration runner is idempotent (re-running is safe)
And the migration runner exits non-zero if any migration fails
And the deployment halts if migrations fail (Workers are not deployed)
```

---

## 3. Acceptance Criteria

| # | Criterion | Verification |
|---|-----------|-------------|
| 1 | `amplify/` directory deleted from repo | `ls amplify/` returns "no such file or directory" |
| 2 | `amplify_outputs.json` deleted | File does not exist |
| 3 | Zero `aws-amplify`, `@aws-amplify/*`, `aws-cdk*` dependencies in package.json | `grep -c amplify package.json` returns 0 |
| 4 | Zero `@aws-sdk/*` dependencies in package.json | `grep -c aws-sdk package.json` returns 0 |
| 5 | `infra/` directory archived (moved to `archive/infra-aws/`) | Old Terraform does not execute |
| 6 | `terraform/` directory contains all Cloudflare IaC | `terraform validate` passes |
| 7 | `terraform plan` shows no diff on a clean production state | Drift-free |
| 8 | PR preview deploys in under 3 minutes | GitHub Actions timing |
| 9 | Production deploy completes in under 5 minutes | GitHub Actions timing |
| 10 | `npm run dev` starts frontend + API locally with zero cloud dependencies | Manual test |
| 11 | D1 migrations run before Workers deploy in production workflow | Workflow step ordering |
| 12 | Secrets exist only in GitHub Actions secrets + Wrangler secrets | Audit: no secrets in git history |
| 13 | Rollback via revert-and-merge restores previous production state | Manual test |
| 14 | All Phase 1-4 BDD tests pass against production deployment | CI green |
| 15 | `wrangler.jsonc` configures all environments (local, preview, production) | File exists and is valid |
| 16 | Terraform state stored in Cloudflare R2 (not local) | Backend config uses R2 |

---

## 4. Terraform Configuration

### 4.1 Directory structure

```
terraform/
  main.tf              # Providers, backend, locals
  cloudflare.tf        # D1, R2, Workers, Pages, DNS
  clerk.tf             # Clerk application (if provider available)
  resend.tf            # Resend domain verification DNS records
  variables.tf         # Input variables
  outputs.tf           # Outputs for CI/CD
  terraform.tfvars     # Non-secret defaults
  environments/
    production.tfvars   # Production overrides
    staging.tfvars      # Staging overrides (future)
```

### 4.2 main.tf

```hcl
terraform {
  required_version = ">= 1.7"

  # VERIFY at implementation time: Cloudflare Terraform provider version.
  # As of early 2026, the stable release is v4.x. v5.0 may introduce breaking
  # changes (resource renames, removed attributes). Pin to the latest stable
  # version available at implementation time and test `terraform plan` output.
  required_providers {
    cloudflare = {
      source  = "cloudflare/cloudflare"
      version = "~> 4.0"  # Update to ~> 5.0 when confirmed stable
    }
  }

  # Store state in Cloudflare R2 via S3-compatible backend.
  # Bucket created manually once: wrangler r2 bucket create pipe-terraform-state
  backend "s3" {
    bucket                      = "pipe-terraform-state"
    key                         = "production/terraform.tfstate"
    region                      = "auto"
    skip_credentials_validation = true
    skip_metadata_api_check     = true
    skip_region_validation      = true
    skip_requesting_account_id  = true
    skip_s3_checksum            = true
    endpoints = {
      s3 = "https://<ACCOUNT_ID>.r2.cloudflarestorage.com"
    }
  }
}

provider "cloudflare" {
  api_token = var.cloudflare_api_token
}

locals {
  project     = "pipe"
  domain      = "pipe.dev"
  environment = var.environment
}
```

### 4.3 variables.tf

```hcl
variable "cloudflare_api_token" {
  description = "Cloudflare API token with Zone + Workers + D1 + R2 + Pages permissions"
  type        = string
  sensitive   = true
}

variable "cloudflare_account_id" {
  description = "Cloudflare account ID"
  type        = string
}

variable "environment" {
  description = "Deployment environment"
  type        = string
  default     = "production"

  validation {
    condition     = contains(["production", "staging"], var.environment)
    error_message = "environment must be 'production' or 'staging'."
  }
}

variable "clerk_publishable_key" {
  description = "Clerk publishable key (safe to expose in frontend)"
  type        = string
}

variable "resend_domain" {
  description = "Domain verified in Resend for sending email"
  type        = string
  default     = "pipe.dev"
}
```

### 4.4 cloudflare.tf

```hcl
# ── D1 Databases ─────────────────────────────────────────────────────────────

resource "cloudflare_d1_database" "production" {
  account_id = var.cloudflare_account_id
  name       = "${local.project}-production"
}

resource "cloudflare_d1_database" "preview" {
  account_id = var.cloudflare_account_id
  name       = "${local.project}-preview"
}

# ── R2 Buckets ───────────────────────────────────────────────────────────────

resource "cloudflare_r2_bucket" "assets_production" {
  account_id = var.cloudflare_account_id
  name       = "${local.project}-assets-production"
}

resource "cloudflare_r2_bucket" "assets_preview" {
  account_id = var.cloudflare_account_id
  name       = "${local.project}-assets-preview"
}

# ── Frontend Deployment ──────────────────────────────────────────────────────
#
# DECISION: Cloudflare Pages vs Workers with Static Assets
#
# Cloudflare is consolidating Pages into Workers. The official migration guide
# (https://developers.cloudflare.com/pages/migration/) recommends deploying
# frontend apps as Workers with static assets (`wrangler deploy` + `assets.directory`)
# instead of Pages. This is the forward-looking approach.
#
# Option A (current): cloudflare_pages_project — works today, may be deprecated.
# Option B (recommended): Deploy frontend as a Worker with static assets via
#   wrangler.jsonc: { "name": "pipe", "assets": { "directory": "./dist" } }
#   and use `wrangler deploy` instead of Pages. No Terraform resource needed
#   for the Worker itself (managed by wrangler deploy in CI).
#
# For now, using Pages. Migrate to Workers + static assets if Pages shows
# deprecation signals or when consolidating the deployment pipeline.

resource "cloudflare_pages_project" "frontend" {
  account_id        = var.cloudflare_account_id
  name              = local.project
  production_branch = "main"

  build_config {
    build_command   = "npm run build"
    destination_dir = "dist"
    root_dir        = ""
  }

  deployment_configs {
    production {
      environment_variables = {
        VITE_API_URL             = "https://api.${local.domain}"
        VITE_CLERK_PUBLISHABLE_KEY = var.clerk_publishable_key
        NODE_VERSION             = "20"
      }
    }

    preview {
      environment_variables = {
        VITE_API_URL             = "https://api-preview.${local.domain}"
        VITE_CLERK_PUBLISHABLE_KEY = var.clerk_publishable_key
        NODE_VERSION             = "20"
      }
    }
  }
}

# ── DNS Records ──────────────────────────────────────────────────────────────

data "cloudflare_zone" "primary" {
  filter {
    account_id = var.cloudflare_account_id
    name       = local.domain
  }
}

# Root domain -> Pages
resource "cloudflare_dns_record" "root" {
  zone_id = data.cloudflare_zone.primary.zone_id
  name    = "@"
  type    = "CNAME"
  content = "${cloudflare_pages_project.frontend.subdomain}"
  proxied = true
}

# www -> Pages
resource "cloudflare_dns_record" "www" {
  zone_id = data.cloudflare_zone.primary.zone_id
  name    = "www"
  type    = "CNAME"
  content = "${cloudflare_pages_project.frontend.subdomain}"
  proxied = true
}

# API subdomain -> Workers custom domain
resource "cloudflare_dns_record" "api" {
  zone_id = data.cloudflare_zone.primary.zone_id
  name    = "api"
  type    = "AAAA"
  content = "100::"
  proxied = true
}

# Preview API subdomain -> Workers custom domain
resource "cloudflare_dns_record" "api_preview" {
  zone_id = data.cloudflare_zone.primary.zone_id
  name    = "api-preview"
  type    = "AAAA"
  content = "100::"
  proxied = true
}

# ── Workers Custom Domains ───────────────────────────────────────────────────

resource "cloudflare_workers_custom_domain" "api_production" {
  account_id = var.cloudflare_account_id
  zone_id    = data.cloudflare_zone.primary.zone_id
  hostname   = "api.${local.domain}"
  service    = "${local.project}-api-production"
}

resource "cloudflare_workers_custom_domain" "api_preview" {
  account_id = var.cloudflare_account_id
  zone_id    = data.cloudflare_zone.primary.zone_id
  hostname   = "api-preview.${local.domain}"
  service    = "${local.project}-api-preview"
}
```

### 4.5 resend.tf

```hcl
# Resend requires DNS verification records for sending email from pipe.dev.
# These are static TXT/CNAME records provided by Resend during domain setup.
# Values are set once after Resend domain creation and rarely change.

variable "resend_dkim_records" {
  description = "DKIM CNAME records from Resend domain setup"
  type = list(object({
    name    = string
    content = string
  }))
  default = []
}

resource "cloudflare_dns_record" "resend_spf" {
  zone_id = data.cloudflare_zone.primary.zone_id
  name    = "@"
  type    = "TXT"
  content = "v=spf1 include:send.resend.com ~all"
}

resource "cloudflare_dns_record" "resend_dkim" {
  for_each = { for idx, r in var.resend_dkim_records : idx => r }

  zone_id = data.cloudflare_zone.primary.zone_id
  name    = each.value.name
  type    = "CNAME"
  content = each.value.content
}
```

### 4.6 outputs.tf

```hcl
output "d1_production_id" {
  description = "Production D1 database ID"
  value       = cloudflare_d1_database.production.id
}

output "d1_preview_id" {
  description = "Preview D1 database ID"
  value       = cloudflare_d1_database.preview.id
}

output "r2_production_bucket" {
  description = "Production R2 bucket name"
  value       = cloudflare_r2_bucket.assets_production.name
}

output "r2_preview_bucket" {
  description = "Preview R2 bucket name"
  value       = cloudflare_r2_bucket.assets_preview.name
}

output "pages_project_name" {
  description = "Cloudflare Pages project name"
  value       = cloudflare_pages_project.frontend.name
}

output "pages_subdomain" {
  description = "Cloudflare Pages subdomain (for DNS CNAME)"
  value       = cloudflare_pages_project.frontend.subdomain
}
```

---

## 5. GitHub Actions Workflows

### 5.1 PR Preview (`.github/workflows/preview.yml`)

```yaml
name: Preview Deploy

on:
  pull_request:
    branches: [main]

concurrency:
  group: preview-${{ github.head_ref }}
  cancel-in-progress: true

jobs:
  preview:
    runs-on: ubuntu-latest
    timeout-minutes: 10
    permissions:
      contents: read
      pull-requests: write
      deployments: write

    steps:
      - uses: actions/checkout@v4

      - uses: actions/setup-node@v4
        with:
          node-version: 20
          cache: npm

      - run: npm ci

      - name: Type check
        run: npx tsc --noEmit

      - name: Run unit tests
        run: npm test

      - name: Run D1 migrations (preview)
        run: npx wrangler d1 migrations apply pipe-preview --remote
        env:
          CLOUDFLARE_API_TOKEN: ${{ secrets.CLOUDFLARE_API_TOKEN }}
          CLOUDFLARE_ACCOUNT_ID: ${{ secrets.CLOUDFLARE_ACCOUNT_ID }}

      - name: Deploy Workers (preview)
        run: npx wrangler deploy --env preview
        env:
          CLOUDFLARE_API_TOKEN: ${{ secrets.CLOUDFLARE_API_TOKEN }}

      - name: Build frontend
        run: npm run build
        env:
          VITE_API_URL: https://api-preview.pipe.dev
          VITE_CLERK_PUBLISHABLE_KEY: ${{ secrets.CLERK_PUBLISHABLE_KEY }}

      - name: Deploy Pages (preview)
        id: pages
        uses: cloudflare/pages-action@v1
        with:
          apiToken: ${{ secrets.CLOUDFLARE_API_TOKEN }}
          accountId: ${{ secrets.CLOUDFLARE_ACCOUNT_ID }}
          projectName: pipe
          directory: dist
          gitHubToken: ${{ secrets.GITHUB_TOKEN }}

      - name: Comment preview URL
        uses: actions/github-script@v7
        with:
          script: |
            github.rest.issues.createComment({
              owner: context.repo.owner,
              repo: context.repo.repo,
              issue_number: context.issue.number,
              body: `## Preview Deployment\n\nFrontend: ${{ steps.pages.outputs.url }}\nAPI: https://api-preview.pipe.dev\n\nCommit: \`${context.sha.slice(0, 7)}\``
            });
```

### 5.2 Production Deploy (`.github/workflows/production.yml`)

```yaml
name: Production Deploy

on:
  push:
    branches: [main]

concurrency:
  group: production
  cancel-in-progress: false

jobs:
  deploy:
    runs-on: ubuntu-latest
    timeout-minutes: 10
    permissions:
      contents: read
      deployments: write

    steps:
      - uses: actions/checkout@v4

      - uses: actions/setup-node@v4
        with:
          node-version: 20
          cache: npm

      - run: npm ci

      - name: Type check
        run: npx tsc --noEmit

      - name: Run unit tests
        run: npm test

      - name: Run D1 migrations (production)
        run: npx wrangler d1 migrations apply pipe-production --remote
        env:
          CLOUDFLARE_API_TOKEN: ${{ secrets.CLOUDFLARE_API_TOKEN }}
          CLOUDFLARE_ACCOUNT_ID: ${{ secrets.CLOUDFLARE_ACCOUNT_ID }}

      - name: Deploy Workers (production)
        run: npx wrangler deploy --env production
        env:
          CLOUDFLARE_API_TOKEN: ${{ secrets.CLOUDFLARE_API_TOKEN }}

      - name: Build frontend
        run: npm run build
        env:
          VITE_API_URL: https://api.pipe.dev
          VITE_CLERK_PUBLISHABLE_KEY: ${{ secrets.CLERK_PUBLISHABLE_KEY }}

      - name: Deploy Pages (production)
        uses: cloudflare/pages-action@v1
        with:
          apiToken: ${{ secrets.CLOUDFLARE_API_TOKEN }}
          accountId: ${{ secrets.CLOUDFLARE_ACCOUNT_ID }}
          projectName: pipe
          directory: dist
          branch: main
          gitHubToken: ${{ secrets.GITHUB_TOKEN }}
```

### 5.3 Terraform Plan (`.github/workflows/terraform-plan.yml`)

```yaml
name: Terraform Plan

on:
  pull_request:
    paths:
      - "terraform/**"

jobs:
  plan:
    runs-on: ubuntu-latest
    timeout-minutes: 5
    permissions:
      contents: read
      pull-requests: write

    defaults:
      run:
        working-directory: terraform

    steps:
      - uses: actions/checkout@v4

      - uses: hashicorp/setup-terraform@v3
        with:
          terraform_version: "1.9"

      - name: Terraform Init
        run: terraform init
        env:
          AWS_ACCESS_KEY_ID: ${{ secrets.R2_ACCESS_KEY_ID }}
          AWS_SECRET_ACCESS_KEY: ${{ secrets.R2_SECRET_ACCESS_KEY }}

      - name: Terraform Validate
        run: terraform validate

      - name: Terraform Plan
        id: plan
        run: terraform plan -no-color -var-file=environments/production.tfvars
        env:
          TF_VAR_cloudflare_api_token: ${{ secrets.CLOUDFLARE_API_TOKEN }}
          TF_VAR_cloudflare_account_id: ${{ secrets.CLOUDFLARE_ACCOUNT_ID }}
          TF_VAR_clerk_publishable_key: ${{ secrets.CLERK_PUBLISHABLE_KEY }}
          AWS_ACCESS_KEY_ID: ${{ secrets.R2_ACCESS_KEY_ID }}
          AWS_SECRET_ACCESS_KEY: ${{ secrets.R2_SECRET_ACCESS_KEY }}

      - name: Comment plan on PR
        uses: actions/github-script@v7
        with:
          script: |
            const plan = `${{ steps.plan.outputs.stdout }}`;
            const truncated = plan.length > 60000
              ? plan.slice(0, 60000) + '\n\n... (truncated)'
              : plan;
            github.rest.issues.createComment({
              owner: context.repo.owner,
              repo: context.repo.repo,
              issue_number: context.issue.number,
              body: `## Terraform Plan\n\n\`\`\`\n${truncated}\n\`\`\``
            });
```

### 5.4 Terraform Apply (`.github/workflows/terraform-apply.yml`)

```yaml
name: Terraform Apply

on:
  push:
    branches: [main]
    paths:
      - "terraform/**"

concurrency:
  group: terraform-apply
  cancel-in-progress: false

jobs:
  apply:
    runs-on: ubuntu-latest
    timeout-minutes: 10
    permissions:
      contents: read

    defaults:
      run:
        working-directory: terraform

    steps:
      - uses: actions/checkout@v4

      - uses: hashicorp/setup-terraform@v3
        with:
          terraform_version: "1.9"

      - name: Terraform Init
        run: terraform init
        env:
          AWS_ACCESS_KEY_ID: ${{ secrets.R2_ACCESS_KEY_ID }}
          AWS_SECRET_ACCESS_KEY: ${{ secrets.R2_SECRET_ACCESS_KEY }}

      - name: Terraform Apply
        run: terraform apply -auto-approve -var-file=environments/production.tfvars
        env:
          TF_VAR_cloudflare_api_token: ${{ secrets.CLOUDFLARE_API_TOKEN }}
          TF_VAR_cloudflare_account_id: ${{ secrets.CLOUDFLARE_ACCOUNT_ID }}
          TF_VAR_clerk_publishable_key: ${{ secrets.CLERK_PUBLISHABLE_KEY }}
          AWS_ACCESS_KEY_ID: ${{ secrets.R2_ACCESS_KEY_ID }}
          AWS_SECRET_ACCESS_KEY: ${{ secrets.R2_SECRET_ACCESS_KEY }}
```

### 5.5 D1 Migration Runner (`.github/workflows/d1-migrate.yml`)

```yaml
name: D1 Migrations

on:
  workflow_call:
    inputs:
      environment:
        required: true
        type: string
        description: "D1 database name (pipe-production or pipe-preview)"

  workflow_dispatch:
    inputs:
      environment:
        required: true
        type: choice
        options:
          - pipe-production
          - pipe-preview
        description: "D1 database to migrate"

jobs:
  migrate:
    runs-on: ubuntu-latest
    timeout-minutes: 5

    steps:
      - uses: actions/checkout@v4

      - uses: actions/setup-node@v4
        with:
          node-version: 20
          cache: npm

      - run: npm ci

      - name: Apply D1 migrations
        run: npx wrangler d1 migrations apply ${{ inputs.environment }} --remote
        env:
          CLOUDFLARE_API_TOKEN: ${{ secrets.CLOUDFLARE_API_TOKEN }}
          CLOUDFLARE_ACCOUNT_ID: ${{ secrets.CLOUDFLARE_ACCOUNT_ID }}

      - name: Verify migration
        run: |
          npx wrangler d1 execute ${{ inputs.environment }} \
            --remote \
            --command "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name;"
        env:
          CLOUDFLARE_API_TOKEN: ${{ secrets.CLOUDFLARE_API_TOKEN }}
          CLOUDFLARE_ACCOUNT_ID: ${{ secrets.CLOUDFLARE_ACCOUNT_ID }}
```

### 5.6 BDD Test Runner (`.github/workflows/bdd-tests.yml`)

```yaml
name: BDD Tests

on:
  workflow_run:
    workflows: ["Production Deploy"]
    types: [completed]

  workflow_dispatch:
    inputs:
      target_url:
        description: "Base URL to test against (defaults to production)"
        required: false
        default: "https://pipe.dev"

jobs:
  bdd:
    runs-on: ubuntu-latest
    timeout-minutes: 15
    if: ${{ github.event.workflow_run.conclusion == 'success' || github.event_name == 'workflow_dispatch' }}

    steps:
      - uses: actions/checkout@v4

      - uses: actions/setup-node@v4
        with:
          node-version: 20
          cache: npm

      - run: npm ci

      - name: Install Playwright browsers
        run: npx playwright install --with-deps chromium

      - name: Run BDD E2E tests
        run: npx playwright test
        env:
          BASE_URL: ${{ inputs.target_url || 'https://pipe.dev' }}
          E2E_EMAIL: ${{ secrets.E2E_EMAIL }}
          E2E_PASSWORD: ${{ secrets.E2E_PASSWORD }}

      - name: Upload test report
        if: always()
        uses: actions/upload-artifact@v4
        with:
          name: bdd-test-report
          path: playwright-report/
          retention-days: 14
```

---

## 6. Local Development Setup

### 6.1 wrangler.jsonc

> **Note:** This section shows TOML syntax for readability but should be implemented as `wrangler.jsonc`. Convert TOML keys to JSON object format (e.g., `name = "pipe-api"` becomes `"name": "pipe-api"`).

```toml
name = "pipe-api"
main = "workers/src/index.ts"
compatibility_date = "2024-12-01"
compatibility_flags = ["nodejs_compat"]

# ── Local development ────────────────────────────────────────────────────────

[dev]
port = 8787
local_protocol = "http"

# ── D1 Bindings ──────────────────────────────────────────────────────────────

[[d1_databases]]
binding = "DB"
database_name = "pipe-local"
database_id = "local"       # Wrangler creates a local SQLite file automatically
migrations_dir = "migrations"

# ── R2 Bindings ──────────────────────────────────────────────────────────────

[[r2_buckets]]
binding = "ASSETS"
bucket_name = "pipe-assets-local"

# ── Environment variables (non-secret) ───────────────────────────────────────

[vars]
ENVIRONMENT = "development"
CORS_ORIGIN = "http://localhost:5173"

# ── Preview environment ──────────────────────────────────────────────────────

[env.preview]
name = "pipe-api-preview"

[[env.preview.d1_databases]]
binding = "DB"
database_name = "pipe-preview"
database_id = ""  # Filled by Terraform output: d1_preview_id
migrations_dir = "migrations"

[[env.preview.r2_buckets]]
binding = "ASSETS"
bucket_name = "pipe-assets-preview"

[env.preview.vars]
ENVIRONMENT = "preview"
CORS_ORIGIN = "https://*.pipe-*.pages.dev"

# ── Production environment ───────────────────────────────────────────────────

[env.production]
name = "pipe-api-production"
routes = [
  { pattern = "api.pipe.dev", custom_domain = true }
]

[[env.production.d1_databases]]
binding = "DB"
database_name = "pipe-production"
database_id = ""  # Filled by Terraform output: d1_production_id
migrations_dir = "migrations"

[[env.production.r2_buckets]]
binding = "ASSETS"
bucket_name = "pipe-assets-production"

[env.production.vars]
ENVIRONMENT = "production"
CORS_ORIGIN = "https://pipe.dev"
```

### 6.2 package.json scripts (after migration)

```json
{
  "scripts": {
    "dev": "concurrently \"vite\" \"wrangler dev\"",
    "dev:frontend": "vite",
    "dev:api": "wrangler dev",
    "build": "tsc --noEmit && vite build",
    "preview": "vite preview",
    "db:migrate": "wrangler d1 migrations apply pipe-local --local",
    "db:migrate:remote": "wrangler d1 migrations apply pipe-production --remote",
    "db:studio": "wrangler d1 execute pipe-local --local --command \"SELECT 1\"",
    "deploy:preview": "wrangler deploy --env preview",
    "deploy:production": "wrangler deploy --env production",
    "test": "vitest run",
    "test:e2e": "playwright test",
    "test:e2e:ui": "playwright test --ui",
    "test:e2e:headed": "playwright test --headed",
    "lint": "eslint . --ext ts,tsx --report-unused-disable-directives --max-warnings 0",
    "storybook": "storybook dev -p 6006",
    "build-storybook": "storybook build",
    "typecheck": "tsc --noEmit"
  }
}
```

### 6.3 Local development flow

```
# First time setup (under 5 minutes):
git clone <repo>
cd PIPE-OS
npm install
cp .env.example .env.local    # Non-secret local overrides only
npm run db:migrate             # Creates local D1 SQLite, runs all migrations
npm run dev                    # Starts Vite (5173) + Wrangler (8787) concurrently

# Day-to-day:
npm run dev                    # That's it
```

### 6.4 .env.example

```bash
# Local development environment variables.
# Copy to .env.local — never commit .env.local.

# Clerk (use Clerk dev instance keys)
VITE_CLERK_PUBLISHABLE_KEY=pk_test_...

# API (local Workers)
VITE_API_URL=http://localhost:8787

# E2E test credentials
E2E_EMAIL=braunjory@gmail.com
E2E_PASSWORD=Wrx7UB35t$

# AI providers (for local scoring/follow-up testing)
# MISTRAL_API_KEY=
# ANTHROPIC_API_KEY=
```

### 6.5 Environment variables / secrets inventory

| Variable | Where | Secret? | Used by |
|----------|-------|---------|---------|
| `CLOUDFLARE_API_TOKEN` | GitHub Actions secrets | Yes | Wrangler + Terraform |
| `CLOUDFLARE_ACCOUNT_ID` | GitHub Actions secrets | Yes | Wrangler + Terraform |
| `R2_ACCESS_KEY_ID` | GitHub Actions secrets | Yes | Terraform backend (R2 state) |
| `R2_SECRET_ACCESS_KEY` | GitHub Actions secrets | Yes | Terraform backend (R2 state) |
| `CLERK_SECRET_KEY` | Wrangler secrets (`wrangler secret put`) | Yes | Workers API |
| `CLERK_PUBLISHABLE_KEY` | GitHub Actions secrets + Terraform | No | Frontend (VITE_) + Terraform |
| `RESEND_API_KEY` | Wrangler secrets | Yes | Workers API |
| `MISTRAL_API_KEY` | Wrangler secrets | Yes | Workers API (scoring) |
| `ANTHROPIC_API_KEY` | Wrangler secrets | Yes | Workers API (follow-up) |
| `E2E_EMAIL` | GitHub Actions secrets | Yes | BDD tests |
| `E2E_PASSWORD` | GitHub Actions secrets | Yes | BDD tests |
| `JWT_SECRET` | Wrangler secrets | Yes | Workers API (session tokens) |

---

## 7. Migration Cleanup

### 7.1 Directories to delete

| Path | Reason |
|------|--------|
| `amplify/` | Entire Amplify backend — auth, data, functions, storage, backend.ts |
| `amplify_outputs.json` | Generated Amplify config consumed by frontend |

### 7.2 Directory to archive

| Path | Move to | Reason |
|------|---------|--------|
| `infra/` | `archive/infra-aws/` | ECS/ALB Terraform for dev containers. Post-MVP, Fly.io replaces this. Keep for reference but do not execute. |

### 7.3 Dependencies to remove from package.json

**dependencies:**
```
@aws-amplify/ui-react
aws-amplify
```

**devDependencies:**
```
@aws-amplify/backend
@aws-amplify/backend-cli
@aws-sdk/client-cognito-identity-provider
@aws-sdk/client-dynamodb
@aws-sdk/client-ses
@aws-sdk/client-ssm
@aws-sdk/lib-dynamodb
@aws-sdk/util-dynamodb
@aws-sdk/s3-request-presigner
aws-cdk
aws-cdk-lib
aws-sdk-client-mock
aws-sdk-client-mock-jest
constructs
```

### 7.4 Dependencies to add

```
wrangler           (devDependency — Cloudflare Workers CLI)
concurrently       (devDependency — parallel dev servers)
@clerk/clerk-js    (dependency — replaces @aws-amplify/ui-react for auth)
hono               (dependency — Workers API framework, likely already added in Phase 1)
```

### 7.5 Files to modify

| File | Change |
|------|--------|
| `package.json` | Remove AWS deps, add Cloudflare/Clerk deps, update scripts |
| `vite.config.ts` | Remove any Amplify plugins, add proxy for local Workers API |
| `tsconfig.json` | Remove `amplify/` from includes if present |
| `.gitignore` | Remove Amplify entries, add `.wrangler/`, `.dev.vars` |
| `CLAUDE.md` | Update tech stack, commands, remove Amplify references |
| `docs/ARCHITECTURE.md` | Update to reflect Cloudflare architecture |
| `docs/STATUS.md` | Update current state |

### 7.6 Files to create

| File | Purpose |
|------|---------|
| `terraform/` (directory) | All Terraform HCL files per section 4 |
| `.github/workflows/preview.yml` | Per section 5.1 |
| `.github/workflows/production.yml` | Per section 5.2 |
| `.github/workflows/terraform-plan.yml` | Per section 5.3 |
| `.github/workflows/terraform-apply.yml` | Per section 5.4 |
| `.github/workflows/d1-migrate.yml` | Per section 5.5 |
| `.github/workflows/bdd-tests.yml` | Per section 5.6 |
| `wrangler.toml` | Per section 6.1 |
| `.env.example` | Per section 6.4 |

---

## 8. Task List

### 8.1 Terraform setup

- [ ] Create `terraform/` directory with all HCL files from section 4
- [ ] Create R2 bucket for Terraform state manually: `wrangler r2 bucket create pipe-terraform-state`
- [ ] Generate R2 API token with S3-compatible access for Terraform backend
- [ ] Run `terraform init` to initialize backend
- [ ] Import existing Cloudflare resources (if any D1/R2/DNS already created in Phases 1-4)
- [ ] Run `terraform plan` and verify it matches expected state
- [ ] Run `terraform apply` to establish baseline

### 8.2 GitHub Actions workflows

- [ ] Create `.github/workflows/` directory
- [ ] Write `preview.yml` (section 5.1)
- [ ] Write `production.yml` (section 5.2)
- [ ] Write `terraform-plan.yml` (section 5.3)
- [ ] Write `terraform-apply.yml` (section 5.4)
- [ ] Write `d1-migrate.yml` (section 5.5)
- [ ] Write `bdd-tests.yml` (section 5.6)
- [ ] Configure GitHub repository secrets:
  - `CLOUDFLARE_API_TOKEN`
  - `CLOUDFLARE_ACCOUNT_ID`
  - `R2_ACCESS_KEY_ID`
  - `R2_SECRET_ACCESS_KEY`
  - `CLERK_PUBLISHABLE_KEY`
  - `E2E_EMAIL`
  - `E2E_PASSWORD`
- [ ] Set Wrangler secrets for production Workers:
  - `wrangler secret put CLERK_SECRET_KEY --env production`
  - `wrangler secret put RESEND_API_KEY --env production`
  - `wrangler secret put MISTRAL_API_KEY --env production`
  - `wrangler secret put ANTHROPIC_API_KEY --env production`
  - `wrangler secret put JWT_SECRET --env production`
- [ ] Test preview workflow on a feature branch
- [ ] Test production workflow by merging to main

### 8.3 Wrangler configuration

- [ ] Write `wrangler.toml` (section 6.1)
- [ ] Fill in D1 database IDs from Terraform outputs into `wrangler.toml`
- [ ] Verify `wrangler dev` starts locally with D1 + R2 bindings
- [ ] Verify `wrangler deploy --env preview` succeeds
- [ ] Verify `wrangler deploy --env production` succeeds

### 8.4 Local development

- [ ] Write `.env.example` (section 6.4)
- [ ] Update `package.json` scripts (section 6.2)
- [ ] Add `concurrently` as a devDependency
- [ ] Verify `npm run dev` starts both Vite and Wrangler
- [ ] Verify `npm run db:migrate` creates local D1 and runs migrations
- [ ] Test full local flow: sign up -> create pipeline -> share link -> complete assessment

### 8.5 Amplify cleanup

- [ ] Delete `amplify/` directory
- [ ] Delete `amplify_outputs.json`
- [ ] Remove all AWS dependencies from `package.json` (section 7.3)
- [ ] Add Cloudflare/Clerk dependencies (section 7.4)
- [ ] Run `npm install` to regenerate lockfile
- [ ] Run `npx tsc --noEmit` — fix any import errors from deleted Amplify modules
- [ ] Update `.gitignore`: remove Amplify entries, add `.wrangler/`, `.dev.vars`
- [ ] Archive `infra/` to `archive/infra-aws/`

### 8.6 Documentation cleanup

- [ ] Update `CLAUDE.md`: remove Amplify references, update tech stack and commands
- [ ] Update `docs/ARCHITECTURE.md`: Cloudflare architecture, new data model
- [ ] Update `docs/STATUS.md`: reflect completed migration
- [ ] Update `package.json` name from `amplify-vite-react-template` to `pipe-os`
- [ ] Write ADR documenting migration from Amplify to Cloudflare (if not already written)

### 8.7 Validation

- [ ] `grep -r "amplify" src/` returns zero results
- [ ] `grep -r "aws-sdk" src/` returns zero results
- [ ] `grep -r "aws-amplify" package.json` returns zero results
- [ ] `npx tsc --noEmit` passes
- [ ] `npm test` passes
- [ ] `npm run dev` starts cleanly with no Amplify references
- [ ] `terraform plan` shows no changes against production
- [ ] Preview deploy works on a test PR
- [ ] Production deploy works on merge to main
- [ ] All Phase 1-4 BDD tests pass against production
- [ ] A fresh clone + `npm install && npm run dev` works in under 5 minutes

---

## 9. Definition of Done

Phase 5 is complete when ALL of the following are true:

1. **Zero Amplify artifacts** — No `amplify/` directory, no `amplify_outputs.json`, no `@aws-amplify/*` or `aws-cdk*` or `@aws-sdk/*` in `package.json`.
2. **Terraform manages all infrastructure** — `terraform plan` against production shows zero changes. All Cloudflare resources (D1, R2, Pages, Workers routes, DNS) are in Terraform state.
3. **CI/CD is fully automated** — PRs get preview deployments. Merges to main deploy to production. Terraform changes are planned on PR, applied on merge. No manual steps.
4. **Migrations run automatically** — D1 migrations execute before Workers deploy in both preview and production pipelines. Migration failures halt deployment.
5. **Local development requires no cloud accounts** — `npm install && npm run dev` starts a working app with local D1, local R2, and Vite dev server. No AWS credentials, no Amplify sandbox.
6. **Secrets are secure** — No secret values in git. Wrangler secrets for Workers. GitHub Actions secrets for CI. Terraform sensitive variables via `TF_VAR_*`.
7. **Rollback works** — A revert-and-merge restores the previous production state within 3 minutes.
8. **All BDD tests pass** — Every test from Phases 1-4 passes against the production deployment created by the new CI/CD pipeline.
9. **Old infra archived** — `infra/` moved to `archive/infra-aws/` for reference. AWS ECS/ALB resources can be manually torn down when Fly.io is ready (post-MVP).
10. **Documentation updated** — `CLAUDE.md`, `docs/ARCHITECTURE.md`, and `docs/STATUS.md` reflect the new stack with no Amplify references.
