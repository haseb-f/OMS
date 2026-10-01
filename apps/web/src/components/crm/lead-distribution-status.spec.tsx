import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";

vi.mock("@/providers/locale-provider", () => ({
  useLocale: () => ({
    t: (key: string, params?: Record<string, unknown>) =>
      params ? `${key} ${JSON.stringify(params)}` : key,
    locale: "en",
    direction: "ltr",
  }),
}));

import {
  canConfirmDistribution,
  describeDistributionControl,
  describeDistributionResult,
  previewDistributionMode,
} from "@/components/crm/lead-distribution-logic";
import {
  LeadDistributionDialog,
  LeadDistributionStatusButton,
} from "@/components/crm/lead-distribution-status";
import type {
  LeadDistributionState,
  RuntimeStatus,
} from "@/components/crm/lead-distribution-control";
import type { LeadDistributionSnapshot } from "@/services/leads-service";

function snap(partial: Partial<LeadDistributionSnapshot> = {}): LeadDistributionSnapshot {
  return {
    policy: null,
    eligible: [{ id: "u1", fullName: "A", email: "a@x" }],
    eligibleCount: 1,
    pendingEligibleCount: 3,
    held: { count: 1, batches: [] },
    team: null,
    ...partial,
  };
}

function makeState(
  status: RuntimeStatus,
  overrides: Partial<LeadDistributionState> = {},
): LeadDistributionState {
  return {
    canManage: true,
    snapshot: snap(),
    status,
    running: status === "CONTINUOUS" || status === "TIME_LIMITED",
    busy: false,
    pendingMode: null,
    pause: vi.fn(),
    applyMode: vi.fn(async () => ({
      run: { assigned: 3, skipped: 0, failureCode: null, failureReason: null },
      snapshot: snap({ pendingEligibleCount: 0, held: { count: 0, batches: [] } }),
    })),
    ...overrides,
  };
}

beforeAll(() => {
  globalThis.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
  Element.prototype.scrollIntoView ??= function scrollIntoView() {};
});

describe("describeDistributionControl", () => {
  it("an active automatic mode is green", () => {
    expect(describeDistributionControl(snap(), "CONTINUOUS")).toMatchObject({
      tone: "success",
      running: true,
      blocked: false,
      eligibleCount: 1,
      pendingCount: 3,
    });
  });
  it("paused and manual are amber, with the backlog still counted", () => {
    expect(describeDistributionControl(snap(), "PAUSED").tone).toBe("warning");
    expect(describeDistributionControl(snap(), "MANUAL").tone).toBe("warning");
  });
  it("an empty pool under an automatic mode is red", () => {
    const d = describeDistributionControl(
      snap({
        eligible: [],
        eligibleCount: 0,
        failureCode: "NO_ELIGIBLE_EMPLOYEES",
        failureReason: "No eligible sales employees.",
      }),
      "CONTINUOUS",
    );
    expect(d).toMatchObject({ tone: "destructive", blocked: true, emptyPool: true });
  });
  it("a paused backlog is never red", () => {
    const d = describeDistributionControl(
      snap({ failureCode: "PENDING_NOT_AUTO", failureReason: "paused" }),
      "PAUSED",
    );
    expect(d).toMatchObject({ tone: "warning", blocked: false });
  });
  it("only TIME_LIMITED exposes an expiry and the team scope is named", () => {
    const policy = {
      id: "p",
      mode: "TIME_LIMITED" as const,
      isActive: true,
      startedAt: "2026-10-01T08:00:00Z",
      expiresAt: "2026-10-02T08:00:00Z",
      remainingMs: 1,
      teamId: "t",
    };
    const s = snap({ policy, team: { id: "t", name: "North" } });
    expect(describeDistributionControl(s, "TIME_LIMITED")).toMatchObject({
      expiresAt: "2026-10-02T08:00:00Z",
      teamName: "North",
    });
    expect(describeDistributionControl(s, "CONTINUOUS").expiresAt).toBeNull();
  });
});

describe("preview / confirm rules", () => {
  it("previews what confirming would do", () => {
    expect(previewDistributionMode("PAUSED", "CONTINUOUS", 2)).toBe("auto");
    expect(previewDistributionMode("CONTINUOUS", "CONTINUOUS", 2)).toBe("autoRerun");
    expect(previewDistributionMode("PAUSED", "TIME_LIMITED", 0)).toBe("autoNoEligible");
    expect(previewDistributionMode("CONTINUOUS", "MANUAL", 2)).toBe("manual");
    expect(previewDistributionMode("CONTINUOUS", "PAUSED", 2)).toBe("paused");
    expect(previewDistributionMode("PAUSED", "PAUSED", 2)).toBe("unchanged");
  });
  it("confirm needs a change (or an automatic re-run) and nothing in flight", () => {
    expect(canConfirmDistribution("PAUSED", "PAUSED", false)).toBe(false);
    expect(canConfirmDistribution("MANUAL", "MANUAL", false)).toBe(false);
    expect(canConfirmDistribution("CONTINUOUS", "CONTINUOUS", false)).toBe(true);
    expect(canConfirmDistribution("PAUSED", "CONTINUOUS", true)).toBe(false);
  });
  it("results report only what the server confirmed", () => {
    const run = { assigned: 0, skipped: 0, failureCode: null, failureReason: null };
    expect(describeDistributionResult({ ...run, assigned: 3 }, 0).kind).toBe("assigned");
    expect(describeDistributionResult(run, 0).kind).toBe("nothing");
    expect(describeDistributionResult({ ...run, alreadyRunning: true }, 2).kind).toBe(
      "alreadyRunning",
    );
    expect(
      describeDistributionResult(
        { ...run, skipped: 2, failureCode: "NO_ELIGIBLE_EMPLOYEES", failureReason: "x" },
        2,
      ),
    ).toEqual({ kind: "blocked", tone: "destructive" });
    expect(describeDistributionResult(null, 0).kind).toBe("saved");
  });
});

describe("LeadDistributionDialog", () => {
  afterEach(cleanup);

  function openDialog(state: LeadDistributionState, onOpenChange = vi.fn()) {
    render(
      <LeadDistributionDialog
        open
        onOpenChange={onOpenChange}
        state={state}
        onOpenTools={vi.fn()}
      />,
    );
    return onOpenChange;
  }

  const confirmButton = () => screen.getByTestId("lead-distribution-confirm");
  const preview = () => screen.getByTestId("lead-distribution-preview");

  it("shows the current mode and eligibility; confirm is off until something changes", () => {
    openDialog(makeState("PAUSED"));
    expect(screen.getByTestId("distribution-eligible").textContent).toBe("1");
    expect(preview().dataset.preview).toBe("unchanged");
    expect(confirmButton()).toHaveProperty("disabled", true);
  });

  it("selecting a mode only previews — no request", () => {
    const state = makeState("PAUSED");
    openDialog(state);
    fireEvent.click(screen.getByRole("radio", { name: /modes\.continuous/ }));
    expect(preview().dataset.preview).toBe("auto");
    expect(confirmButton()).toHaveProperty("disabled", false);
    expect(state.applyMode).not.toHaveBeenCalled();
  });

  it("cancel sends nothing", () => {
    const state = makeState("PAUSED");
    const onOpenChange = openDialog(state);
    fireEvent.click(screen.getByRole("radio", { name: /modes\.manual/ }));
    fireEvent.click(screen.getByRole("button", { name: "common.cancel" }));
    expect(onOpenChange).toHaveBeenCalledWith(false);
    expect(state.applyMode).not.toHaveBeenCalled();
  });

  it("confirm calls the activate path once and shows the server result", async () => {
    const state = makeState("PAUSED");
    openDialog(state);
    fireEvent.click(screen.getByRole("radio", { name: /modes\.continuous/ }));
    await act(async () => {
      fireEvent.click(confirmButton());
    });
    expect(state.applyMode).toHaveBeenCalledTimes(1);
    expect(state.applyMode).toHaveBeenCalledWith("CONTINUOUS");
    expect(screen.getByTestId("lead-distribution-result").textContent).toContain(
      'leadOps.distribution.dialog.resultAssigned {"assigned":3,"pending":0,"held":0}',
    );
  });

  it("a blocked run shows the failure code and the fix links", async () => {
    const state = makeState("PAUSED", {
      applyMode: vi.fn(async () => ({
        run: {
          assigned: 0,
          skipped: 2,
          failureCode: "NO_ELIGIBLE_EMPLOYEES",
          failureReason: "No eligible sales employees.",
        },
        snapshot: snap({ eligible: [], eligibleCount: 0 }),
      })),
    });
    openDialog(state);
    fireEvent.click(screen.getByRole("radio", { name: /modes\.hours/ }));
    await act(async () => {
      fireEvent.click(confirmButton());
    });
    expect(screen.getByTestId("lead-distribution-result").textContent).toContain(
      "NO_ELIGIBLE_EMPLOYEES",
    );
    expect(screen.getByRole("link", { name: /fixUsers/ }).getAttribute("href")).toBe(
      "/settings/users",
    );
  });

  it("while a confirm is running the dialog cannot submit again or close", () => {
    const state = makeState("CONTINUOUS", { busy: true });
    const onOpenChange = openDialog(state);
    expect(confirmButton()).toHaveProperty("disabled", true);
    fireEvent.click(confirmButton());
    fireEvent.keyDown(document.activeElement ?? document.body, { key: "Escape" });
    expect(state.applyMode).not.toHaveBeenCalled();
    expect(onOpenChange).not.toHaveBeenCalledWith(false);
  });
});

describe("LeadDistributionStatusButton", () => {
  afterEach(cleanup);

  it("always shows the state text and the pending count", () => {
    render(<LeadDistributionStatusButton state={makeState("MANUAL")} onOpenTools={vi.fn()} />);
    const button = screen.getByTestId("lead-distribution-control");
    expect(button.dataset.stateTone).toBe("warning");
    expect(button.textContent).toContain("leadOps.distribution.button.manual");
    expect(button.textContent).toContain('leadOps.distribution.button.pending {"count":3}');
  });

  it("is hidden without crm.leads.manage", () => {
    render(
      <LeadDistributionStatusButton
        state={makeState("CONTINUOUS", { canManage: false })}
        onOpenTools={vi.fn()}
      />,
    );
    expect(screen.queryByTestId("lead-distribution-control")).toBeNull();
  });
});
