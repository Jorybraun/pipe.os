/**
 * e2e/role-discovery.spec.ts
 *
 * BDD: Role Discovery — Conversational intake + Synthesis + Calibration
 *
 * Feature: Role Discovery
 *   As a recruiter
 *   I want to describe a role through a short conversation
 *   So that PIPE generates a Role Context Document I can calibrate before
 *   creating a pipeline
 *
 * Auth: authenticated (playwright.config.ts)
 * Route: /pipeline/new
 * API base: http://localhost:8787
 */

import { test, expect, type Page } from "@playwright/test";
import { API_BASE, APP_BASE } from './env';

// ─── Mock data ────────────────────────────────────────────────────────────────

const MOCK_CONTEXT_ID = "rc-e2e-001";
const MOCK_PARTICIPANT_ID = "part-e2e-001";

const MOCK_PERSONA = {
  archetype: "Product-Minded Engineer",
  seniority: "Senior",
  mustHaveSkills: ["React", "TypeScript"],
  niceToHaveSkills: ["GraphQL"],
  disposition: ["Collaborative", "Pragmatic"],
  redFlags: [],
  dealbreakers: [],
  careerSignal: "Looking for impact and autonomy",
};

const MOCK_RCD = {
  domain_matrix: {
    hiring_manager: {
      team: {
        laddering_chains: [
          {
            consequence: "Leads cross-functional projects",
            attribute_quote: "We need someone who can lead",
            source_exchange_id: "1",
            energy_signal: "high",
            value: "Leadership",
            confidence: 0.9,
          },
        ],
      },
      bar: {
        laddering_chains: [
          {
            consequence: "Sets technical direction",
            attribute_quote: "They should guide architecture",
            source_exchange_id: "2",
            energy_signal: "medium",
            value: "Technical vision",
            confidence: 0.8,
          },
        ],
      },
    },
  },
  technical_context: {
    stack: ["React", "TypeScript", "Next.js"],
    constructs: ["Frontend", "SPA"],
    seniority_band: "Senior",
    codebase_expectations: ["Clean code", "Tests"],
    dispositional_weights: { ownership: 0.85, collaboration: 0.75 },
  },
  team_culture_profile: {
    per_stakeholder: {
      hiring_manager: {
        clan_affinity: 0.6,
        adhocracy_affinity: 0.4,
        market_affinity: 0.5,
        hierarchy_affinity: 0.3,
        psychological_safety: 0.8,
      },
    },
    aggregated: {
      formula: "mean",
      clan_affinity: 0.6,
      adhocracy_affinity: 0.4,
      market_affinity: 0.5,
      hierarchy_affinity: 0.3,
      psychological_safety: 0.8,
    },
  },
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

async function setupRoleDiscoveryMocks(page: Page): Promise<void> {
  // Create role context — only intercept POST
  await page.route(
    `${API_BASE}/api/v1/role-contexts`,
    async (route) => {
      if (route.request().method() !== "POST") {
        await route.fallback();
        return;
      }
      await route.fulfill({
        status: 201,
        contentType: "application/json",
        body: JSON.stringify({
          id: MOCK_CONTEXT_ID,
          participantId: MOCK_PARTICIPANT_ID,
        }),
      });
    },
  );

  // Start interview — returns calibration question
  await page.route(
    `${API_BASE}/api/v1/role-contexts/${MOCK_CONTEXT_ID}/start`,
    async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          acknowledgment: "Great, let's begin.",
          question: {
            id: "q-calibration",
            text: "What is your role in this hiring process?",
            input: { type: "text" },
          },
          progress: { asked: 0, budget: 15, domains: {} },
        }),
      });
    },
  );

  // Respond — 5 question turns then synthesis on the 6th call
  let respondCount = 0;
  await page.route(
    `${API_BASE}/api/v1/role-contexts/${MOCK_CONTEXT_ID}/respond`,
    async (route) => {
      respondCount++;
      const isSynthesis = respondCount >= 6;

      const payload = isSynthesis
        ? {
            synthesis: "Role profile synthesis complete.",
            persona: MOCK_PERSONA,
            jobDescription:
              "# Senior Frontend Engineer\n\nWe are hiring a senior frontend engineer.",
            progress: {
              asked: 6,
              budget: 15,
              domains: {
                why: "complete",
                work: "complete",
                team: "complete",
                bar: "complete",
                codebase: "complete",
                process: "complete",
              },
            },
            rcd: MOCK_RCD,
            participantId: MOCK_PARTICIPANT_ID,
          }
        : {
            acknowledgment: "Thanks for that.",
            question: {
              id: `q-${respondCount}`,
              text: `AI question ${respondCount}?`,
              input: { type: "text" },
            },
            progress: {
              asked: respondCount,
              budget: 15,
              domains: {},
            },
            participantId: MOCK_PARTICIPANT_ID,
          };

      await route.fulfill({
        status: 200,
        contentType: "text/event-stream",
        body: `event: done\ndata: ${JSON.stringify(payload)}\n\n`,
      });
    },
  );

  // Calibrate — return immediately, no artificial delay
  await page.route(
    `${API_BASE}/api/v1/role-contexts/${MOCK_CONTEXT_ID}/calibrate`,
    async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          question: "Can you clarify what you mean by that?",
        }),
      });
    },
  );

  // Calibrate respond (gap fill)
  await page.route(
    `${API_BASE}/api/v1/role-contexts/${MOCK_CONTEXT_ID}/calibrate/respond`,
    async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          rcd: MOCK_RCD,
        }),
      });
    },
  );
}

async function fillScriptedPhase(page: Page): Promise<void> {
  // Question 1: role title
  await expect(page.locator('[data-testid="scripted-input"] input')).toBeVisible({
    timeout: 15000,
  });
  await page
    .locator('[data-testid="scripted-input"] input')
    .fill("Senior Frontend Engineer");
  await page.locator('[data-testid="scripted-send-btn"]').click();

  // Question 2: company
  await expect(page.locator('[data-testid="scripted-input"] input')).toBeVisible({
    timeout: 15000,
  });
  await page.locator('[data-testid="scripted-input"] input').fill("Acme Corp");
  await page.locator('[data-testid="scripted-send-btn"]').click();

  // Question 3: website
  await expect(page.locator('[data-testid="scripted-input"] input')).toBeVisible({
    timeout: 15000,
  });
  await page
    .locator('[data-testid="scripted-input"] input')
    .fill("https://acme.com");
  await page.locator('[data-testid="scripted-send-btn"]').click();

  // Question 4: salary
  await expect(page.locator('[data-testid="scripted-input"] input')).toBeVisible({
    timeout: 15000,
  });
  await page
    .locator('[data-testid="scripted-input"] input')
    .fill("$150K–$180K + equity");
  await page.locator('[data-testid="scripted-send-btn"]').click();

  // Question 5: tech stack (tags)
  await expect(page.locator('[data-testid="scripted-input"] input')).toBeVisible({
    timeout: 15000,
  });
  await page.locator('[data-testid="scripted-input"] input').fill("React");
  await page.locator('[data-testid="scripted-input"] input').press("Enter");
  await page.locator('[data-testid="scripted-input"] input').fill("TypeScript");
  await page.locator('[data-testid="scripted-input"] input').press("Enter");
  await page.locator('[data-testid="scripted-input"] input').fill("Next.js");
  await page.locator('[data-testid="scripted-input"] input').press("Enter");
  await page.locator('[data-testid="scripted-send-btn"]').click();
}

async function answerAIPhaseToSynthesis(page: Page): Promise<void> {
  // 6 AI questions (calibration + 5 turns)
  for (let i = 0; i < 6; i++) {
    await expect(page.locator('[data-testid="ai-input"] input')).toBeVisible({
      timeout: 15000,
    });
    await page.locator('[data-testid="ai-input"] input').fill("Test answer");
    await page.locator('[data-testid="ai-send-btn"]').click();
  }

  // Synthesis renders
  await expect(
    page.locator('[data-testid="interview-complete-header"]'),
  ).toBeVisible({ timeout: 15000 });
}

async function driveToSynthesis(page: Page): Promise<void> {
  await fillScriptedPhase(page);
  await answerAIPhaseToSynthesis(page);
}

// ─── Suite: Conversational intake ─────────────────────────────────────────────

test.describe("Feature: Role Discovery — conversational intake", () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => {
      localStorage.removeItem("role_discovery_draft");
    });
    await setupRoleDiscoveryMocks(page);
    await page.goto(`${APP_BASE}/pipeline/new`);
  });

  test("Scenario: recruiter can complete role discovery in ≤ 6 AI questions", async ({
    page,
  }) => {
    // 1. Wait for the scripted phase to render
    await expect(
      page.locator('[data-testid="scripted-input"] input'),
    ).toBeVisible({ timeout: 15000 });

    // 2. Fill the 5 scripted baseline inputs
    await fillScriptedPhase(page);

    // 3. Answer AI interview questions until synthesis triggers
    await answerAIPhaseToSynthesis(page);

    // 4. Assert synthesis rendered (proves ≤ 6 AI turns)
    await expect(
      page.locator('[data-testid="create-pipeline-btn"]'),
    ).toBeVisible();
  });
});

// ─── Suite: Synthesis ─────────────────────────────────────────────────────────

test.describe("Feature: Role Discovery — synthesis", () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => {
      localStorage.removeItem("role_discovery_draft");
    });
    await setupRoleDiscoveryMocks(page);
    await page.goto(`${APP_BASE}/pipeline/new`);
  });

  test("Scenario: synthesis produces Role Context Document with 3 sections", async ({
    page,
  }) => {
    // 1. Complete the interview flow
    await driveToSynthesis(page);

    // 2. Click ROLE CONTEXT tab
    await page.locator('[data-testid="role-context-tab"]').click();

    // 3. Assert 3 sections exist
    await expect(
      page.locator('[data-testid="role-context-section-team"]'),
    ).toBeVisible();
    await expect(
      page.locator('[data-testid="role-context-section-technical"]'),
    ).toBeVisible();
    await expect(
      page.locator('[data-testid="role-context-section-dispositional"]'),
    ).toBeVisible();
  });
});

// ─── Suite: Calibration review ────────────────────────────────────────────────

test.describe("Feature: Role Discovery — calibration review", () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => {
      localStorage.removeItem("role_discovery_draft");
    });
    await setupRoleDiscoveryMocks(page);
    await page.goto(`${APP_BASE}/pipeline/new`);
  });

  test("Scenario: calibration review UI appears and allows flagging", async ({
    page,
  }) => {
    // 1. Reach the synthesis / review phase
    await driveToSynthesis(page);

    // 2. Click ROLE CONTEXT tab
    await page.locator('[data-testid="role-context-tab"]').click();

    // 3. Assert calibration flag buttons exist on a laddering card
    const card = page.locator('[data-testid="laddering-card"]').first();
    await expect(card).toBeVisible();

    await expect(
      card.locator('[data-testid="flag-button-inaccurate"]'),
    ).toBeVisible();
    await expect(
      card.locator('[data-testid="flag-button-missing-evidence"]'),
    ).toBeVisible();
    await expect(
      card.locator('[data-testid="flag-button-add-detail"]'),
    ).toBeVisible();

    // 4. Click "Not quite right" and assert loading state
    await card.locator('[data-testid="flag-button-inaccurate"]').click();
    await expect(page.locator('[data-testid="calibration-loading"]')).toBeVisible({
      timeout: 5000,
    });
  });

  test("Scenario: gap-filling asks a clarifying question", async ({ page }) => {
    // 1. Reach the review phase with an RCD loaded
    await driveToSynthesis(page);

    // 2. Click ROLE CONTEXT tab
    await page.locator('[data-testid="role-context-tab"]').click();

    // 3. Flag an attribute to trigger gap-filling
    const card = page.locator('[data-testid="laddering-card"]').first();
    await card.locator('[data-testid="flag-button-inaccurate"]').click();

    // 4. Wait for GapFillModal
    const modal = page.locator('[data-testid="gap-fill-modal"]');
    await expect(modal).toBeVisible({ timeout: 15000 });

    const questionText = page.locator('[data-testid="gap-fill-question"]');
    await expect(questionText).not.toHaveText("");

    // 5. Submit an answer
    await page
      .locator('[data-testid="gap-fill-answer"]')
      .fill("We use Next.js 14 with App Router.");
    await page.locator('[data-testid="gap-fill-submit"]').click();

    // 6. Modal closes and RCD updates
    await expect(modal).not.toBeVisible({ timeout: 10000 });
  });
});
