import { render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { CandidateIntakeModal } from "./CandidateIntakeModal";

const mocks = vi.hoisted(() => ({
  create: vi.fn(),
  getToken: vi.fn(),
}));

vi.mock("../../hooks/useCandidateCreate", () => ({
  useCandidateCreate: () => ({
    create: mocks.create,
    isSubmitting: false,
  }),
}));

vi.mock("../../providers/clerk", () => ({
  useClerkAuth: () => ({
    getToken: mocks.getToken,
  }),
}));

vi.mock("../../contexts/ThemeContext", () => ({
  useTheme: () => ({
    theme: { mode: "dark" },
  }),
}));

vi.mock("../../lib/api/client", () => ({
  createApiClient: () => ({
    post: vi.fn(),
  }),
}));

describe("CandidateIntakeModal layout", () => {
  it("bounds the dialog at 825x868 and keeps intake actions visible outside the scroll body", () => {
    window.innerWidth = 825;
    window.innerHeight = 868;

    render(
      <CandidateIntakeModal
        pipelineId="pipeline-1"
        stageId="stage-1"
        onClose={vi.fn()}
        onSuccess={vi.fn()}
      />,
    );

    const dialog = screen.getByRole("dialog", { name: "Add candidate" });
    expect(dialog).toHaveStyle({
      maxHeight: "calc(100dvh - 40px)",
      display: "flex",
      flexDirection: "column",
      overflow: "hidden",
    });

    const scrollBody = screen.getByTestId("candidate-intake-body");
    expect(scrollBody).toHaveStyle({
      overflowY: "auto",
      flex: "1 1 auto",
      minHeight: "0",
    });

    const footer = screen.getByTestId("candidate-intake-actions");
    expect(footer).toHaveStyle({
      flexShrink: "0",
    });
    expect(
      within(footer).getByRole("button", { name: /INITIATE_INTAKE/i }),
    ).toBeVisible();
    expect(
      within(footer).getByRole("button", { name: "CANCEL" }),
    ).toBeVisible();
    expect(
      within(scrollBody).queryByRole("button", { name: /INITIATE_INTAKE/i }),
    ).toBeNull();
    expect(
      within(scrollBody).queryByRole("button", { name: "CANCEL" }),
    ).toBeNull();
  });
});
