---
description: >-
  Vitest unit testing, Playwright E2E testing, Storybook component testing
  patterns
---
# Testing Standards

## Testing Stack

### Unit & Component Testing

- **Framework:** Vitest 4.0
- **Browser Testing:** @vitest/browser-playwright
- **Coverage:** @vitest/coverage-v8
- **Component Testing:** Storybook 10.1 with @storybook/addon-vitest

### End-to-End Testing

- **Framework:** Playwright 1.57
- **Browser Support:** Chromium, Firefox, WebKit

## Test File Organization

### Directory Structure

```
project/
├── src/
│   ├── components/
│   │   └── PipelineCard/
│   │       ├── PipelineCard.tsx
│   │       ├── PipelineCard.test.tsx      # Unit tests
│   │       └── PipelineCard.stories.tsx   # Component tests via Storybook
│   └── hooks/
│       └── usePipelines/
│           ├── usePipelines.ts
│           └── usePipelines.test.ts       # Hook tests
├── e2e/
│   ├── pipelines.spec.ts                   # E2E tests
│   └── auth.spec.ts
└── vitest.config.ts
```

### Naming Conventions

- Unit tests: `*.test.ts` or `*.test.tsx`
- E2E tests: `*.spec.ts`
- Stories: `*.stories.tsx`

## Unit Testing

### Basic Test Structure

```typescript
import { describe, it, expect, beforeEach, vi } from "vitest";
import { formatPipelineName, calculateScore } from "./utils";

describe("formatPipelineName", () => {
  it("should capitalize the first letter of each word", () => {
    // Arrange
    const input = "frontend developer assessment";

    // Act
    const result = formatPipelineName(input);

    // Assert
    expect(result).toBe("Frontend Developer Assessment");
  });

  it("should handle empty strings", () => {
    expect(formatPipelineName("")).toBe("");
  });

  it("should handle single word names", () => {
    expect(formatPipelineName("backend")).toBe("Backend");
  });
});

describe("calculateScore", () => {
  it("should return weighted average of stage scores", () => {
    const stages = [
      { score: 80, weight: 0.5 },
      { score: 90, weight: 0.3 },
      { score: 70, weight: 0.2 },
    ];

    const result = calculateScore(stages);

    expect(result).toBe(81); // (80*0.5 + 90*0.3 + 70*0.2)
  });

  it("should exclude stages with null scores", () => {
    const stages = [
      { score: 80, weight: 0.5 },
      { score: null, weight: 0.3 },
      { score: 70, weight: 0.2 },
    ];

    const result = calculateScore(stages);

    // Weight is renormalized: 0.5/(0.5+0.2) = 0.714, 0.2/(0.5+0.2) = 0.286
    expect(result).toBeCloseTo(77.14, 1);
  });
});
```

### Testing Async Functions

```typescript
import { describe, it, expect, vi } from "vitest";
import { createPipeline, fetchPipeline } from "./api";
import { client } from "../amplify-client";

// Mock the Amplify client
vi.mock("../amplify-client", () => ({
  client: {
    models: {
      Pipeline: {
        create: vi.fn(),
        get: vi.fn(),
      },
    },
  },
}));

describe("createPipeline", () => {
  it("should create a pipeline and return it", async () => {
    // Arrange
    const mockPipeline = {
      id: "123",
      name: "Test Pipeline",
      status: "DRAFT",
    };
    vi.mocked(client.models.Pipeline.create).mockResolvedValue({
      data: mockPipeline,
      errors: undefined,
    });

    // Act
    const result = await createPipeline("Test Pipeline");

    // Assert
    expect(result).toEqual(mockPipeline);
    expect(client.models.Pipeline.create).toHaveBeenCalledWith({
      name: "Test Pipeline",
      status: "DRAFT",
    });
  });

  it("should throw when creation fails", async () => {
    // Arrange
    vi.mocked(client.models.Pipeline.create).mockResolvedValue({
      data: null,
      errors: [{ message: "Creation failed" }],
    });

    // Act & Assert
    await expect(createPipeline("Test")).rejects.toThrow("Creation failed");
  });
});
```

### Testing React Hooks

```typescript
import { describe, it, expect, vi } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { usePipelines } from "./usePipelines";
import { client } from "../amplify-client";

vi.mock("../amplify-client");

describe("usePipelines", () => {
  it("should fetch and return pipelines", async () => {
    // Arrange
    const mockPipelines = [
      { id: "1", name: "Pipeline 1" },
      { id: "2", name: "Pipeline 2" },
    ];

    vi.mocked(client.models.Pipeline.observeQuery).mockReturnValue({
      subscribe: (handlers) => {
        handlers.next({ items: mockPipelines, isSynced: true });
        return { unsubscribe: vi.fn() };
      },
    });

    // Act
    const { result } = renderHook(() => usePipelines());

    // Assert
    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    expect(result.current.pipelines).toEqual(mockPipelines);
    expect(result.current.error).toBeNull();
  });

  it("should handle subscription errors", async () => {
    // Arrange
    const error = new Error("Subscription failed");
    vi.mocked(client.models.Pipeline.observeQuery).mockReturnValue({
      subscribe: (handlers) => {
        handlers.error(error);
        return { unsubscribe: vi.fn() };
      },
    });

    // Act
    const { result } = renderHook(() => usePipelines());

    // Assert
    await waitFor(() => {
      expect(result.current.error).toBe(error);
    });
  });
});
```

## Component Testing

### With Storybook and Vitest

```typescript
// PipelineCard.stories.tsx
import type { Meta, StoryObj } from "@storybook/react";
import { expect, within, userEvent } from "@storybook/test";
import { PipelineCard } from "./PipelineCard";

const meta: Meta<typeof PipelineCard> = {
  title: "Features/Pipeline/PipelineCard",
  component: PipelineCard,
};

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  args: {
    pipeline: {
      id: "1",
      name: "Test Pipeline",
      description: "A test pipeline",
      status: "ACTIVE",
    },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    // Verify content renders
    expect(canvas.getByText("Test Pipeline")).toBeInTheDocument();
    expect(canvas.getByText("A test pipeline")).toBeInTheDocument();
  },
};

export const WithInteraction: Story = {
  args: {
    pipeline: {
      id: "1",
      name: "Interactive Pipeline",
    },
    onEdit: vi.fn(),
  },
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement);

    // Click edit button
    const editButton = canvas.getByRole("button", { name: /edit/i });
    await userEvent.click(editButton);

    // Verify callback was called
    expect(args.onEdit).toHaveBeenCalledWith("1");
  },
};
```

### Direct Component Tests

```typescript
// PipelineCard.test.tsx
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { PipelineCard } from "./PipelineCard";

describe("PipelineCard", () => {
  const defaultProps = {
    pipeline: {
      id: "1",
      name: "Test Pipeline",
      description: "Test description",
      status: "ACTIVE" as const,
    },
  };

  it("renders pipeline information", () => {
    render(<PipelineCard {...defaultProps} />);

    expect(screen.getByText("Test Pipeline")).toBeInTheDocument();
    expect(screen.getByText("Test description")).toBeInTheDocument();
  });

  it("calls onEdit when edit button is clicked", () => {
    const onEdit = vi.fn();
    render(<PipelineCard {...defaultProps} onEdit={onEdit} />);

    fireEvent.click(screen.getByRole("button", { name: /edit/i }));

    expect(onEdit).toHaveBeenCalledWith("1");
  });

  it("shows delete confirmation before deleting", async () => {
    const onDelete = vi.fn();
    render(<PipelineCard {...defaultProps} onDelete={onDelete} />);

    // Click delete
    fireEvent.click(screen.getByRole("button", { name: /delete/i }));

    // Confirmation should appear
    expect(screen.getByText(/are you sure/i)).toBeInTheDocument();

    // Confirm deletion
    fireEvent.click(screen.getByRole("button", { name: /confirm/i }));

    expect(onDelete).toHaveBeenCalledWith("1");
  });
});
```

## E2E Testing with Playwright

### Test Structure

```typescript
// e2e/pipelines.spec.ts
import { test, expect } from "@playwright/test";

test.describe("Pipeline Management", () => {
  test.beforeEach(async ({ page }) => {
    // Login before each test
    await page.goto("/login");
    await page.fill('[name="email"]', "test@example.com");
    await page.fill('[name="password"]', "TestPassword123!");
    await page.click('button[type="submit"]');
    await page.waitForURL("/dashboard");
  });

  test("should create a new pipeline", async ({ page }) => {
    // Navigate to pipeline creation
    await page.click("text=Create Pipeline");
    await page.waitForURL("/pipelines/new");

    // Fill in pipeline details
    await page.fill('[name="name"]', "E2E Test Pipeline");
    await page.fill('[name="description"]', "Created by E2E test");

    // Submit form
    await page.click('button[type="submit"]');

    // Verify redirect and success message
    await page.waitForURL(/\/pipelines\/[\w-]+$/);
    await expect(page.locator(".toast-success")).toContainText(
      "Pipeline created"
    );
  });

  test("should list user pipelines", async ({ page }) => {
    await page.goto("/pipelines");

    // Verify pipeline list loads
    await expect(
      page.locator('[data-testid="pipeline-card"]')
    ).toHaveCount.greaterThan(0);
  });

  test("should edit pipeline name", async ({ page }) => {
    await page.goto("/pipelines");

    // Click first pipeline's edit button
    await page
      .locator('[data-testid="pipeline-card"]')
      .first()
      .locator('button[aria-label="Edit"]')
      .click();

    // Update name
    await page.fill('[name="name"]', "Updated Pipeline Name");
    await page.click('button[type="submit"]');

    // Verify update
    await expect(
      page.locator('[data-testid="pipeline-card"]').first()
    ).toContainText("Updated Pipeline Name");
  });
});
```

### Page Object Pattern

```typescript
// e2e/pages/PipelinePage.ts
import { type Page, type Locator } from "@playwright/test";

export class PipelinePage {
  readonly page: Page;
  readonly nameInput: Locator;
  readonly descriptionInput: Locator;
  readonly submitButton: Locator;
  readonly pipelineCards: Locator;

  constructor(page: Page) {
    this.page = page;
    this.nameInput = page.locator('[name="name"]');
    this.descriptionInput = page.locator('[name="description"]');
    this.submitButton = page.locator('button[type="submit"]');
    this.pipelineCards = page.locator('[data-testid="pipeline-card"]');
  }

  async goto() {
    await this.page.goto("/pipelines");
  }

  async createPipeline(name: string, description?: string) {
    await this.page.click("text=Create Pipeline");
    await this.nameInput.fill(name);
    if (description) {
      await this.descriptionInput.fill(description);
    }
    await this.submitButton.click();
  }

  async getPipelineCount() {
    return this.pipelineCards.count();
  }
}

// Usage in test
test("should create pipeline", async ({ page }) => {
  const pipelinePage = new PipelinePage(page);
  await pipelinePage.goto();
  await pipelinePage.createPipeline("New Pipeline", "Description");
});
```

## Testing Best Practices

### Arrange-Act-Assert Pattern

```typescript
it("should calculate total score correctly", () => {
  // Arrange - Set up test data
  const scores = [85, 90, 78, 92];

  // Act - Execute the function
  const result = calculateTotal(scores);

  // Assert - Verify the result
  expect(result).toBe(345);
});
```

### Test Isolation

```typescript
describe("PipelineService", () => {
  let mockClient: MockClient;

  beforeEach(() => {
    // Fresh mock for each test
    mockClient = createMockClient();
    vi.clearAllMocks();
  });

  afterEach(() => {
    // Clean up
    vi.restoreAllMocks();
  });
});
```

### Descriptive Test Names

```typescript
// BAD
it("works", () => {});
it("test 1", () => {});

// GOOD
it("should return empty array when no pipelines exist", () => {});
it("should throw ValidationError when name exceeds 100 characters", () => {});
it("should update status to ACTIVE when all stages are configured", () => {});
```

### Test Coverage Goals

- **Critical paths:** 90%+ coverage
- **Business logic:** 80%+ coverage
- **UI components:** 70%+ coverage
- **Utilities:** 100% coverage

### What NOT to Test

1. Third-party library internals
2. TypeScript type definitions
3. Simple getter/setter methods
4. Framework code (React, Amplify)

## Running Tests

```bash
# Run all unit tests
npm run test

# Run with coverage
npm run test:coverage

# Run specific test file
npm run test -- src/components/PipelineCard.test.tsx

# Run tests in watch mode
npm run test -- --watch

# Run E2E tests
npm run test:e2e

# Run E2E tests in headed mode (see browser)
npm run test:e2e -- --headed

# Run specific E2E test
npm run test:e2e -- pipelines.spec.ts
```

## CI/CD Integration

```yaml
# .github/workflows/test.yml
name: Tests

on: [push, pull_request]

jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: "20"

      - run: npm ci
      - run: npm run lint
      - run: npm run test:coverage
      - run: npx playwright install --with-deps
      - run: npm run test:e2e
```
