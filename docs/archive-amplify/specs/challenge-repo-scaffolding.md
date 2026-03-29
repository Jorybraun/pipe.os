# Challenge Repository Scaffolding System

> **Status:** Proposed
> **Author:** Jory Braun
> **Date:** 2026-03-08
> **Linear Epic:** Challenge Repository System

---

## Problem

Pipe's code review and code implementation challenges currently use inline code snippets stored in `challengeLibrary.ts`. These snippets are 20–60 lines of isolated code — useful for quick screening, but they don't test whether a candidate can navigate a real codebase, understand existing patterns, or contribute production-quality work.

To assess senior-level skills, candidates need to work inside realistic Node + React projects with routing, middleware, database models, tests, and the kind of complexity that exposes real engineering judgment.

## Solution

Build a **CLI scaffolding tool** (`pipe-scaffold`) that generates realistic, self-contained Node + React challenge repositories from config files. Each config describes a domain (e-commerce, messaging, developer tools), a specific challenge task, and exactly which files should be stubbed, completed, or contain intentional bugs for review.

The output is a git repo with two branches:

- `main` — the working base project
- `challenge/{challenge-id}` — the branch with intentional gaps, stubs, or buggy PR changes

This repo gets loaded into a dev container (existing `devContainerLaunch` Lambda) or served through Monaco in-browser.

## Scope Boundary

This spec covers **only** the standalone repos, the scaffolding CLI, and the challenge definitions. It does **not** cover:

- How repos get stored (S3, GitHub, or embedded)
- How the pipe-os platform loads or references them (schema changes, CodeArtifact wiring)
- Dev container integration beyond what already exists
- Scoring or rubric automation

Those are future design tasks that depend on decisions not yet made.

---

## The Three Source Apps

We use three Gemini gym apps as **reference material** for data models, business logic, and API patterns. We are not upgrading the gyms — we are building new, production-quality Node + React projects inspired by them.

### App 1: "StoreFront" (E-Commerce — from Stripe + Shopify gyms)

**Why this domain:** E-commerce is the most universally understood domain. Every developer has mental models for products, orders, customers, and payments. It tests backend CRUD, payment flows, auth, and React state management.

**Source material from gyms:**

- Stripe gym: Customer, Product, Price, PaymentIntent, Invoice, Subscription, Coupon, Dispute models. API tools for `create_customer`, `create_payment_intent`, `create_refund`, `list_invoices`, etc.
- Shopify gym: Customer with addresses, Product with variants, Order with line items, DraftOrder lifecycle. API tools for `create_order`, `cancel_order`, `create_draft_order`, etc.

**Target tech stack:**

- **Backend:** Express.js + TypeScript, Prisma ORM, PostgreSQL (SQLite for local dev), JWT auth with Passport
- **Frontend:** React 18 + TypeScript, React Router v6, TanStack Query for data fetching, Tailwind CSS
- **Testing:** Vitest for unit tests, Supertest for API tests, Playwright for E2E (pre-written, candidates run them)

**Data model (TypeScript/Prisma):**

```prisma
model User {
  id        String   @id @default(cuid())
  email     String   @unique
  password  String
  role      Role     @default(CUSTOMER)
  orders    Order[]
  createdAt DateTime @default(now())
}

model Product {
  id          String    @id @default(cuid())
  title       String
  description String?
  price       Int       // cents
  sku         String    @unique
  inventory   Int       @default(0)
  status      ProductStatus @default(ACTIVE)
  variants    Variant[]
  lineItems   LineItem[]
  createdAt   DateTime  @default(now())
}

model Variant {
  id        String  @id @default(cuid())
  productId String
  product   Product @relation(fields: [productId], references: [id])
  title     String
  price     Int
  sku       String  @unique
  inventory Int     @default(0)
}

model Order {
  id              String      @id @default(cuid())
  orderNumber     Int         @unique @default(autoincrement())
  userId          String
  user            User        @relation(fields: [userId], references: [id])
  status          OrderStatus @default(PENDING)
  financialStatus FinancialStatus @default(UNPAID)
  lineItems       LineItem[]
  totalCents      Int
  shippingAddress Json?
  createdAt       DateTime    @default(now())
  updatedAt       DateTime    @updatedAt
}

model LineItem {
  id        String  @id @default(cuid())
  orderId   String
  order     Order   @relation(fields: [orderId], references: [id])
  productId String
  product   Product @relation(fields: [productId], references: [id])
  quantity  Int
  priceCents Int
}

enum Role { CUSTOMER ADMIN }
enum ProductStatus { ACTIVE DRAFT ARCHIVED }
enum OrderStatus { PENDING CONFIRMED SHIPPED DELIVERED CANCELLED }
enum FinancialStatus { UNPAID PAID PARTIALLY_REFUNDED REFUNDED }
```

**File structure of generated repo:**

```
storefront/
├── package.json
├── tsconfig.json
├── prisma/
│   ├── schema.prisma
│   ├── seed.ts                  # 50 products, 10 users, 25 orders
│   └── migrations/
├── src/
│   ├── server.ts                # Express app setup
│   ├── config/
│   │   └── env.ts               # Environment config
│   ├── middleware/
│   │   ├── auth.ts              # JWT verification
│   │   ├── errorHandler.ts      # Global error handler
│   │   ├── validate.ts          # Zod request validation
│   │   └── rateLimit.ts         # Rate limiting
│   ├── routes/
│   │   ├── auth.routes.ts       # POST /auth/login, /auth/register
│   │   ├── products.routes.ts   # CRUD /products
│   │   ├── orders.routes.ts     # CRUD /orders
│   │   ├── cart.routes.ts       # /cart operations
│   │   └── admin.routes.ts      # Admin-only endpoints
│   ├── services/
│   │   ├── auth.service.ts      # Auth business logic
│   │   ├── product.service.ts   # Product business logic
│   │   ├── order.service.ts     # Order business logic
│   │   └── cart.service.ts      # Cart business logic
│   ├── types/
│   │   └── index.ts             # Shared types
│   └── utils/
│       ├── errors.ts            # Custom error classes
│       └── pagination.ts        # Cursor pagination helper
├── client/
│   ├── package.json
│   ├── vite.config.ts
│   ├── index.html
│   ├── src/
│   │   ├── App.tsx
│   │   ├── main.tsx
│   │   ├── api/
│   │   │   └── client.ts        # Axios instance + interceptors
│   │   ├── hooks/
│   │   │   ├── useAuth.ts
│   │   │   ├── useProducts.ts
│   │   │   └── useOrders.ts
│   │   ├── pages/
│   │   │   ├── LoginPage.tsx
│   │   │   ├── ProductListPage.tsx
│   │   │   ├── ProductDetailPage.tsx
│   │   │   ├── CartPage.tsx
│   │   │   ├── CheckoutPage.tsx
│   │   │   ├── OrderHistoryPage.tsx
│   │   │   └── AdminDashboardPage.tsx
│   │   ├── components/
│   │   │   ├── ProductCard.tsx
│   │   │   ├── CartDrawer.tsx
│   │   │   ├── OrderTable.tsx
│   │   │   └── Layout.tsx
│   │   └── context/
│   │       ├── AuthContext.tsx
│   │       └── CartContext.tsx
│   └── public/
├── tests/
│   ├── unit/
│   │   ├── auth.service.test.ts
│   │   ├── order.service.test.ts
│   │   └── product.service.test.ts
│   ├── integration/
│   │   ├── auth.routes.test.ts
│   │   ├── products.routes.test.ts
│   │   └── orders.routes.test.ts
│   └── e2e/
│       ├── checkout.spec.ts
│       └── admin.spec.ts
├── .devcontainer/
│   └── devcontainer.json
├── docker-compose.yml           # App + Postgres
└── README.md                    # Setup instructions
```

---

### App 2: "DevHub" (Developer Tools — from GitHub gym)

**Why this domain:** Tests file system abstractions, tree structures, diff rendering, and complex state management. Directly relevant to building developer tools — a common hiring signal for senior roles.

**Source material from gyms:**

- GitHub gym: Repository, FileContent, DirectoryItem, Commit, CommitDetail, Branch, CodeSearchResult models. API tools for `search_repositories`, `get_repository_file_contents`, `create_or_update_repository_file`, `list_repository_commits`, `create_repository_branch`, etc. State management via direct HTTP (GET/PUT/POST state endpoints).

**Target tech stack:** Same as StoreFront (Express + React + Prisma + PostgreSQL).

**Data model:**

```prisma
model Repository {
  id          String   @id @default(cuid())
  name        String
  description String?
  ownerId     String
  owner       User     @relation(fields: [ownerId], references: [id])
  isPrivate   Boolean  @default(false)
  language    String?
  stars       Int      @default(0)
  branches    Branch[]
  commits     Commit[]
  files       File[]
  createdAt   DateTime @default(now())
  @@unique([ownerId, name])
}

model Branch {
  id           String     @id @default(cuid())
  name         String
  repositoryId String
  repository   Repository @relation(fields: [repositoryId], references: [id])
  headCommitId String?
  isDefault    Boolean    @default(false)
  isProtected  Boolean    @default(false)
  @@unique([repositoryId, name])
}

model Commit {
  id           String     @id @default(cuid())
  sha          String     @unique
  message      String
  authorId     String
  author       User       @relation(fields: [authorId], references: [id])
  repositoryId String
  repository   Repository @relation(fields: [repositoryId], references: [id])
  parentSha    String?
  additions    Int        @default(0)
  deletions    Int        @default(0)
  createdAt    DateTime   @default(now())
}

model File {
  id           String     @id @default(cuid())
  path         String
  name         String
  content      String?    // null for directories
  isDirectory  Boolean    @default(false)
  sha          String
  repositoryId String
  repository   Repository @relation(fields: [repositoryId], references: [id])
  branchName   String
  @@unique([repositoryId, branchName, path])
}
```

**File structure:** Same pattern as StoreFront — Express routes for repos/branches/commits/files, React frontend with repo browser, file viewer, commit history, and branch management.

---

### App 3: "TeamChat" (Messaging — from Slack gym)

**Why this domain:** Tests real-time patterns (WebSocket), complex UI state (channels, threads, presence), and message ordering — problems that expose concurrency and performance awareness.

**Source material from gyms:**

- Slack gym: Channel and message models, real-time message delivery patterns, channel membership, message threading. The gym has both Slack and embedded Shopify sub-apps demonstrating cross-app integration.

**Target tech stack:** Same base as StoreFront, plus `ws` (WebSocket library) for real-time messaging.

**Data model:**

```prisma
model Channel {
  id          String    @id @default(cuid())
  name        String    @unique
  description String?
  isPrivate   Boolean   @default(false)
  members     ChannelMember[]
  messages    Message[]
  createdAt   DateTime  @default(now())
}

model ChannelMember {
  id        String   @id @default(cuid())
  channelId String
  channel   Channel  @relation(fields: [channelId], references: [id])
  userId    String
  user      User     @relation(fields: [userId], references: [id])
  role      ChannelRole @default(MEMBER)
  joinedAt  DateTime @default(now())
  @@unique([channelId, userId])
}

model Message {
  id        String    @id @default(cuid())
  content   String
  channelId String
  channel   Channel   @relation(fields: [channelId], references: [id])
  authorId  String
  author    User      @relation(fields: [authorId], references: [id])
  parentId  String?   // thread replies
  parent    Message?  @relation("ThreadReplies", fields: [parentId], references: [id])
  replies   Message[] @relation("ThreadReplies")
  editedAt  DateTime?
  createdAt DateTime  @default(now())
}

model Reaction {
  id        String  @id @default(cuid())
  emoji     String
  messageId String
  message   Message @relation(fields: [messageId], references: [id])
  userId    String
  user      User    @relation(fields: [userId], references: [id])
  @@unique([messageId, userId, emoji])
}

enum ChannelRole { MEMBER ADMIN OWNER }
```

---

## Challenge Definitions

Each app gets **3 challenges** — one code review and two feature implementations. These are designed to take 20–45 minutes each and test specific, observable skills.

### StoreFront Challenges

#### SF-CR-1: "Add Coupon Support to Checkout" (Code Review)

**Type:** CODE_REVIEW
**Difficulty:** Intermediate
**Time:** 25 minutes
**Skills tested:** Security awareness, input validation, race conditions, API design

**Setup:** The `main` branch has a working checkout flow. A PR branch `feature/coupon-support` adds coupon functionality with the following intentional bugs:

| File | Bug | Type | Severity |
|------|-----|------|----------|
| `src/routes/orders.routes.ts` | Coupon discount applied after tax calculation instead of before — inflates the discount value | LOGIC | major |
| `src/services/order.service.ts` | No validation that coupon hasn't expired. `expiresAt` field exists but is never checked | LOGIC | major |
| `src/services/order.service.ts` | Coupon usage count incremented before order is confirmed — a failed payment still "uses" the coupon | LOGIC | major |
| `src/middleware/validate.ts` | Coupon code passed directly into Prisma `findFirst` without sanitization — allows injection of `OR` clauses via object syntax | SECURITY | critical |
| `src/services/order.service.ts` | No check for minimum order amount. Coupon model has `minimumOrderCents` but the service ignores it | LOGIC | minor |
| `src/routes/orders.routes.ts` | No rate limiting on coupon validation endpoint — allows brute-force coupon code guessing | SECURITY | major |
| `client/src/pages/CheckoutPage.tsx` | Discount amount displayed as dollars but calculated in cents — shows 100x the actual discount | LOGIC | minor |

**PR description the candidate sees:**

```
## PR: Add coupon/discount code support to checkout

Adds the ability for customers to apply coupon codes during checkout.

Changes:
- Added Coupon model to Prisma schema
- New POST /orders/validate-coupon endpoint
- Updated order creation to apply discounts
- Added coupon input field to CheckoutPage
- Added coupon validation middleware

Testing performed:
- Created test coupons and applied them to orders
- Verified percentage and fixed-amount discounts work
- Verified invalid codes return 400
```

#### SF-IMPL-1: "Implement Authentication" (Code Implementation)

**Type:** CODE_IMPLEMENTATION
**Difficulty:** Intermediate
**Time:** 35 minutes
**Skills tested:** Auth flow design, password hashing, JWT handling, middleware patterns, React context

**Setup:** The `main` branch has a working app with products and orders, but no authentication. The challenge branch `challenge/implement-auth` has:

**Files that are complete (candidate should read, not modify):**

- `prisma/schema.prisma` — User model already exists with `email`, `password`, `role` fields
- `src/types/index.ts` — `AuthPayload`, `LoginRequest`, `RegisterRequest` types defined
- `src/config/env.ts` — `JWT_SECRET` and `JWT_EXPIRY` already loaded
- `client/src/pages/LoginPage.tsx` — Form UI is built, calls `useAuth().login(email, password)`
- `client/src/pages/RegisterPage.tsx` — Form UI is built, calls `useAuth().register(email, password, name)`

**Files with TODO stubs (candidate must implement):**

```typescript
// src/middleware/auth.ts — STUB
import { Request, Response, NextFunction } from 'express';

/**
 * TODO: Implement JWT authentication middleware.
 *
 * Requirements:
 * 1. Extract Bearer token from Authorization header
 * 2. Verify token using JWT_SECRET from env config
 * 3. Attach decoded user payload to req.user
 * 4. Call next() on success, return 401 on failure
 * 5. Handle expired tokens with a specific error message
 */
export function authenticate(req: Request, res: Response, next: NextFunction): void {
  // TODO: implement
  next();
}

/**
 * TODO: Implement role-based authorization middleware.
 *
 * Requirements:
 * 1. Check that req.user exists (authenticate must run first)
 * 2. Check that req.user.role is in the allowed roles
 * 3. Return 403 if not authorized
 */
export function authorize(...roles: string[]) {
  return (req: Request, res: Response, next: NextFunction): void => {
    // TODO: implement
    next();
  };
}
```

```typescript
// src/services/auth.service.ts — STUB
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

/**
 * TODO: Implement user registration.
 *
 * Requirements:
 * 1. Check if email is already taken (throw ConflictError if so)
 * 2. Hash password with bcrypt (12 rounds)
 * 3. Create user in database
 * 4. Return a signed JWT with { userId, email, role } payload
 * 5. Never return the password hash in any response
 */
export async function register(email: string, password: string, name: string): Promise<{ token: string; user: { id: string; email: string; role: string } }> {
  // TODO: implement
  throw new Error('Not implemented');
}

/**
 * TODO: Implement user login.
 *
 * Requirements:
 * 1. Find user by email (throw AuthenticationError if not found)
 * 2. Compare password with stored hash
 * 3. Return signed JWT on success
 * 4. Use constant-time comparison to prevent timing attacks
 */
export async function login(email: string, password: string): Promise<{ token: string; user: { id: string; email: string; role: string } }> {
  // TODO: implement
  throw new Error('Not implemented');
}
```

```typescript
// src/routes/auth.routes.ts — STUB
import { Router } from 'express';

const router = Router();

/**
 * TODO: Implement auth routes.
 *
 * POST /auth/register — calls auth.service.register
 * POST /auth/login — calls auth.service.login
 * GET /auth/me — returns current user (requires authenticate middleware)
 *
 * Use the validate middleware with Zod schemas for request validation.
 */

export default router;
```

```typescript
// client/src/context/AuthContext.tsx — STUB
/**
 * TODO: Implement AuthContext provider.
 *
 * Requirements:
 * 1. Store JWT in localStorage
 * 2. Expose login(email, password), register(email, password, name), logout()
 * 3. On mount, check localStorage for existing token and validate it via GET /auth/me
 * 4. Attach token to all API requests via axios interceptor
 * 5. Redirect to /login on 401 responses
 */
```

**Pre-written tests that should pass when implementation is correct:**

- `tests/integration/auth.routes.test.ts` — 8 tests covering register, login, duplicate email, bad password, token in response, /me endpoint, expired token, invalid token
- `tests/unit/auth.service.test.ts` — 6 tests covering hash verification, JWT payload shape, missing user, role in token

#### SF-IMPL-2: "Add Pagination to Product List" (Code Implementation)

**Type:** CODE_IMPLEMENTATION
**Difficulty:** Beginner
**Time:** 20 minutes
**Skills tested:** Cursor-based pagination, API design, React data fetching, query parameters

**Setup:** The product list currently returns all products in a single response. Challenge branch `challenge/add-pagination` has:

**Stubs:**

- `src/utils/pagination.ts` — TODO: implement `paginateQuery(model, cursor, limit)` helper that returns `{ data, nextCursor, hasMore }`
- `src/routes/products.routes.ts` — The GET `/products` handler needs to accept `?cursor=xxx&limit=20` query params and use the pagination helper
- `client/src/hooks/useProducts.ts` — TODO: convert from `useQuery` to `useInfiniteQuery` with TanStack Query
- `client/src/pages/ProductListPage.tsx` — TODO: add "Load More" button that calls `fetchNextPage()`

**Pre-written tests:** 4 API tests (default limit, custom limit, cursor works, empty page returns hasMore=false), 2 component tests (renders load more button, hides button when no more pages).

---

### DevHub Challenges

#### DH-CR-1: "File Upload to Repository" (Code Review)

**Type:** CODE_REVIEW
**Difficulty:** Advanced
**Time:** 30 minutes
**Skills tested:** File handling security, path traversal, encoding, error handling, resource cleanup

**Setup:** PR branch `feature/file-upload` adds multi-file upload to repositories.

| File | Bug | Type | Severity |
|------|-----|------|----------|
| `src/routes/files.routes.ts` | No path traversal check — `../../../etc/passwd` as file path would escape the repo root | SECURITY | critical |
| `src/services/file.service.ts` | File content stored as raw string without size limit — a 500MB upload crashes the server (no streaming, loaded into memory) | PERFORMANCE | critical |
| `src/services/file.service.ts` | Binary files base64-encoded before storage but never decoded on retrieval — returns garbled content for images/PDFs | LOGIC | major |
| `src/routes/files.routes.ts` | Upload endpoint creates commit but doesn't update branch HEAD ref — file exists in DB but branch still points to old commit | LOGIC | critical |
| `src/middleware/validate.ts` | File extension checked via `path.endsWith('.exe')` blocklist instead of allowlist — misses `.bat`, `.sh`, `.cmd`, double extensions like `.pdf.exe` | SECURITY | major |
| `client/src/components/FileUpload.tsx` | Drag-and-drop handler doesn't prevent default on `dragover` — browser opens the file instead of uploading it | LOGIC | minor |
| `src/services/file.service.ts` | SHA hash computed from filename instead of content — different files with same name get same SHA, causing silent overwrites | LOGIC | major |

#### DH-IMPL-1: "Implement Branch Comparison (Diff View)" (Code Implementation)

**Type:** CODE_IMPLEMENTATION
**Difficulty:** Advanced
**Time:** 45 minutes
**Skills tested:** Tree diffing algorithms, unified diff format, React component composition, performance with large datasets

**Stubs:**

- `src/services/diff.service.ts` — TODO: implement `compareBranches(repoId, baseBranch, headBranch)` that returns list of changed files with `{ path, status: 'added'|'modified'|'deleted', hunks: DiffHunk[] }`
- `src/routes/repos.routes.ts` — TODO: add `GET /repos/:id/compare/:base...:head` endpoint
- `client/src/components/DiffView.tsx` — TODO: render unified diff with line numbers, additions (green), deletions (red), context lines
- `client/src/pages/ComparePage.tsx` — TODO: branch selector dropdowns, file list sidebar, diff panel

**Pre-written tests:** Diff service tests comparing known branch states, component tests verifying correct line counts and color coding.

#### DH-IMPL-2: "Add Repository Search" (Code Implementation)

**Type:** CODE_IMPLEMENTATION
**Difficulty:** Beginner
**Time:** 20 minutes
**Skills tested:** Full-text search, debouncing, API query parameters, result highlighting

**Stubs:**

- `src/services/search.service.ts` — TODO: implement `searchRepositories(query, filters)` with Prisma full-text search
- `src/routes/search.routes.ts` — TODO: `GET /search?q=xxx&language=ts&sort=stars`
- `client/src/hooks/useSearch.ts` — TODO: debounced search with 300ms delay using `useDeferredValue` or custom debounce
- `client/src/pages/SearchPage.tsx` — TODO: search input, filter sidebar, results with highlighted matching terms

---

### TeamChat Challenges

#### TC-CR-1: "Add Message Threading" (Code Review)

**Type:** CODE_REVIEW
**Difficulty:** Intermediate
**Time:** 25 minutes
**Skills tested:** Data modeling, recursive queries, real-time consistency, UI state management

**Setup:** PR branch `feature/message-threading` adds reply threads to messages.

| File | Bug | Type | Severity |
|------|-----|------|----------|
| `src/services/message.service.ts` | Thread replies fetched with `findMany({ where: { parentId } })` without limit or pagination — a thread with 10k replies loads all into memory | PERFORMANCE | critical |
| `src/services/message.service.ts` | Reply count computed by fetching all replies and returning `.length` instead of using `_count` — O(n) DB reads on every message render | PERFORMANCE | major |
| `src/ws/handlers/message.handler.ts` | Thread reply broadcast sent to entire channel instead of only thread subscribers — every user gets every reply notification | LOGIC | major |
| `src/ws/handlers/message.handler.ts` | WebSocket `onclose` handler removes user from channel members instead of just marking as offline — disconnecting deletes membership | LOGIC | critical |
| `client/src/components/ThreadPanel.tsx` | Thread panel subscribes to WebSocket messages but never unsubscribes on unmount — memory leak, duplicate messages on re-open | EDGE_CASE | major |
| `src/routes/messages.routes.ts` | DELETE endpoint allows any authenticated user to delete any message — no ownership check | SECURITY | critical |

#### TC-IMPL-1: "Implement Real-Time Messaging" (Code Implementation)

**Type:** CODE_IMPLEMENTATION
**Difficulty:** Advanced
**Time:** 45 minutes
**Skills tested:** WebSocket lifecycle, real-time state sync, reconnection handling, optimistic UI

**Stubs:**

- `src/ws/server.ts` — TODO: WebSocket server setup with `ws` library, connection tracking per channel
- `src/ws/handlers/message.handler.ts` — TODO: handle `send_message`, `typing_start`, `typing_stop` events
- `src/ws/handlers/presence.handler.ts` — TODO: track online/offline status, broadcast to channel members
- `client/src/hooks/useWebSocket.ts` — TODO: WebSocket hook with auto-reconnect, exponential backoff, message queue for offline sends
- `client/src/components/MessageInput.tsx` — TODO: typing indicators, optimistic message append, error retry
- `client/src/context/PresenceContext.tsx` — TODO: online user list, last-seen timestamps

#### TC-IMPL-2: "Add Channel Management" (Code Implementation)

**Type:** CODE_IMPLEMENTATION
**Difficulty:** Beginner
**Time:** 25 minutes
**Skills tested:** CRUD, role-based access, form handling, list/detail UI pattern

**Stubs:**

- `src/services/channel.service.ts` — TODO: `createChannel`, `updateChannel`, `deleteChannel`, `addMember`, `removeMember` with role checks (only OWNER/ADMIN can modify)
- `src/routes/channels.routes.ts` — TODO: RESTful channel endpoints with auth middleware
- `client/src/pages/ChannelSettingsPage.tsx` — TODO: edit name/description, member list with role badges, invite form, leave/delete buttons

---

## The Scaffolding CLI: `pipe-scaffold`

### What It Does

Takes a challenge config file → produces a git repo with working base + challenge branch.

### How It Works

```
pipe-scaffold generate --config challenges/sf-impl-1-auth.yaml --output ./output/storefront-auth
```

1. **Copy base template** — The full StoreFront/DevHub/TeamChat project from a templates directory
2. **Apply seed data** — Run the Prisma seed script to populate realistic data
3. **Initialize git** — `git init`, commit everything to `main`
4. **Apply challenge overlay** — Read the config's `stubs` section, replace specified files with their stub versions
5. **Create challenge branch** — Commit the stubs to `challenge/{id}`
6. **For code reviews** — Instead of stubs, apply the buggy implementation as a PR branch and generate a diff

### Challenge Config Format

```yaml
# challenges/sf-impl-1-auth.yaml
id: sf-impl-1-auth
app: storefront
type: CODE_IMPLEMENTATION
title: "Implement Authentication"
difficulty: intermediate
estimatedMinutes: 35
description: >
  The StoreFront app has products and orders but no authentication.
  Implement JWT-based auth with registration, login, and route protection.

instructions: |
  ## Your Task

  Implement authentication for the StoreFront e-commerce application.

  ### What's already done:
  - User model exists in Prisma schema
  - Login and Register page UIs are built
  - Type definitions for auth payloads exist
  - Environment config loads JWT_SECRET and JWT_EXPIRY

  ### What you need to implement:
  1. `src/middleware/auth.ts` — JWT verification middleware + role authorization
  2. `src/services/auth.service.ts` — Register and login business logic
  3. `src/routes/auth.routes.ts` — Auth route handlers
  4. `client/src/context/AuthContext.tsx` — React auth state management

  ### Requirements:
  - Passwords must be hashed with bcrypt (12 rounds)
  - JWT payload must include userId, email, and role
  - Protected routes should return 401 without token, 403 without correct role
  - Client should store token in localStorage and attach via Authorization header
  - Client should redirect to /login on 401 responses

  ### Running tests:
  ```
  npm test -- --grep "auth"
  ```

  All 14 auth-related tests should pass when your implementation is correct.

stubs:
  - path: src/middleware/auth.ts
    template: stubs/storefront/auth-middleware.stub.ts
  - path: src/services/auth.service.ts
    template: stubs/storefront/auth-service.stub.ts
  - path: src/routes/auth.routes.ts
    template: stubs/storefront/auth-routes.stub.ts
  - path: client/src/context/AuthContext.tsx
    template: stubs/storefront/auth-context.stub.tsx

tests:
  - path: tests/integration/auth.routes.test.ts
    expectPass: true
  - path: tests/unit/auth.service.test.ts
    expectPass: true

scoring:
  automated:
    - name: "All auth tests pass"
      weight: 40
      check: "test-pass"
    - name: "TypeScript compiles with no errors"
      weight: 10
      check: "tsc-noEmit"
  rubric:
    - name: "Password hashing uses bcrypt, not plain text or MD5"
      weight: 15
    - name: "JWT secret loaded from env, not hardcoded"
      weight: 10
    - name: "Error messages don't leak whether email exists"
      weight: 10
    - name: "Constant-time password comparison"
      weight: 5
    - name: "Token expiry is set"
      weight: 5
    - name: "AuthContext properly cleans up on logout"
      weight: 5
```

### Code Review Config Format

```yaml
# challenges/sf-cr-1-coupon.yaml
id: sf-cr-1-coupon
app: storefront
type: CODE_REVIEW
title: "Add Coupon Support to Checkout"
difficulty: intermediate
estimatedMinutes: 25

prDescription: |
  ## PR: Add coupon/discount code support to checkout
  ...

bugs:
  - file: src/routes/orders.routes.ts
    line: 47
    type: LOGIC
    severity: major
    description: "Coupon discount applied after tax calculation"
    explanation: "Discount should be subtracted from subtotal before tax is computed, otherwise the customer gets a larger discount than intended."
  # ... (all bugs listed in challenge definition above)

overlay:
  # Files to replace on the PR branch with buggy versions
  - path: src/routes/orders.routes.ts
    template: overlays/storefront/coupon-orders-routes.buggy.ts
  - path: src/services/order.service.ts
    template: overlays/storefront/coupon-order-service.buggy.ts
  - path: src/middleware/validate.ts
    template: overlays/storefront/coupon-validate.buggy.ts
  - path: client/src/pages/CheckoutPage.tsx
    template: overlays/storefront/coupon-checkout.buggy.tsx

scoring:
  automated:
    - name: "Identified ≥5 of 7 bugs"
      weight: 50
      check: "bug-count-gte-5"
  rubric:
    - name: "Correctly identified the security issues (injection, rate limiting)"
      weight: 20
    - name: "Identified the race condition with coupon usage count"
      weight: 15
    - name: "Provided actionable fix suggestions, not just 'this is wrong'"
      weight: 15
```

### CLI Commands

```bash
# Generate a challenge repo
pipe-scaffold generate --config challenges/sf-impl-1-auth.yaml --output ./out/

# List all available challenges
pipe-scaffold list

# Validate a config file (check all referenced templates exist)
pipe-scaffold validate --config challenges/sf-impl-1-auth.yaml

# Generate all challenges for an app
pipe-scaffold generate-all --app storefront --output ./out/
```

### Directory Structure of pipe-scaffold

```
pipe-scaffold/
├── package.json
├── tsconfig.json
├── src/
│   ├── cli.ts                    # Commander.js CLI entry
│   ├── commands/
│   │   ├── generate.ts           # Generate a single challenge repo
│   │   ├── list.ts               # List available challenges
│   │   └── validate.ts           # Validate config files
│   ├── generators/
│   │   ├── base.generator.ts     # Copy template, init git
│   │   ├── stub.generator.ts     # Apply stubs for IMPL challenges
│   │   └── overlay.generator.ts  # Apply buggy overlays for CR challenges
│   └── utils/
│       ├── git.ts                # simple-git wrapper
│       ├── config.ts             # YAML config loader + Zod validation
│       └── template.ts           # File copy + variable substitution
├── templates/
│   ├── storefront/               # Complete working StoreFront app
│   ├── devhub/                   # Complete working DevHub app
│   └── teamchat/                 # Complete working TeamChat app
├── stubs/
│   ├── storefront/               # Stub files per challenge
│   ├── devhub/
│   └── teamchat/
├── overlays/
│   ├── storefront/               # Buggy files for code reviews
│   ├── devhub/
│   └── teamchat/
├── challenges/
│   ├── sf-cr-1-coupon.yaml
│   ├── sf-impl-1-auth.yaml
│   ├── sf-impl-2-pagination.yaml
│   ├── dh-cr-1-file-upload.yaml
│   ├── dh-impl-1-diff-view.yaml
│   ├── dh-impl-2-search.yaml
│   ├── tc-cr-1-threading.yaml
│   ├── tc-impl-1-realtime.yaml
│   └── tc-impl-2-channels.yaml
└── tests/
    ├── generate.test.ts
    └── validate.test.ts
```

---

## Task Breakdown

### Phase 1: Build the three base apps (templates)

Each app is a fully working project that runs locally with `docker-compose up` and has seed data.

1. **Build StoreFront base app** — Express + Prisma + React. Products, orders, cart — no auth, no coupons. Seed 50 products, 10 users, 25 orders. Verify `npm run dev` starts, `npm test` passes, `docker-compose up` works.
2. **Build DevHub base app** — Express + Prisma + React. Repos, files, commits, branches — no upload, no diff, no search. Seed 5 repos with realistic file trees and commit histories.
3. **Build TeamChat base app** — Express + Prisma + React + ws. Channels, messages (REST only in base) — no WebSocket, no threading, no channel management. Seed 8 channels with 200 messages.

### Phase 2: Write challenge stubs, overlays, and tests

For each of the 9 challenges, create:

4. **Write StoreFront challenge content** — 3 challenges: stub files for auth + pagination, buggy overlay files for coupon review, pre-written test files for all three.
5. **Write DevHub challenge content** — 3 challenges: stubs for diff view + search, buggy overlay for file upload review, pre-written tests.
6. **Write TeamChat challenge content** — 3 challenges: stubs for real-time + channels, buggy overlay for threading review, pre-written tests.

### Phase 3: Build pipe-scaffold CLI

7. **Build pipe-scaffold CLI** — Commander.js app with `generate`, `list`, `validate` commands. Reads YAML configs, copies templates, applies stubs/overlays, creates git branches.
8. **Write challenge YAML configs** — All 9 config files with complete instructions, scoring rubrics, and file references.
9. **Test end-to-end** — Generate each of the 9 challenges, verify the repo starts, the tests fail (for impl) or pass (for base), and the diff looks right (for reviews).
