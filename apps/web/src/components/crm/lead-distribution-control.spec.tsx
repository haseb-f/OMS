import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";

const service = vi.hoisted(() => ({
  distribution: vi.fn(),
  activateContinuous: vi.fn(),
  activate24h: vi.fn(),
  activateManual: vi.fn(),
  pauseDistribution: vi.fn(),
}));

vi.mock("@/services/leads-service", () => ({ leadsService: service }));
vi.mock("@/providers/locale-provider", () => ({
  useLocale: () => ({ t: (key: string) => key, locale: "en", direction: "ltr" }),
}));
vi.mock("@/providers/user-context", () => ({
  useUserContext: () => ({ hasPermission: () => true }),
}));
vi.mock("@/lib/toast", () => ({ toast: { success: vi.fn() }, reportApiError: vi.fn() }));

import { useLeadDistribution } from "@/components/crm/lead-distribution-control";

const teamPolicy = {
  id: "p1",
  mode: "CONTINUOUS" as const,
  isActive: true,
  startedAt: "2026-10-01T08:00:00Z",
  expiresAt: null,
  remainingMs: null,
  teamId: "team-1",
  departmentId: null,
};

describe("useLeadDistribution", () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("confirm keeps the team scope the dialog showed (never widened)", async () => {
    const snapshot = { status: "CONTINUOUS" as const, policy: teamPolicy, eligible: [] };
    service.distribution.mockResolvedValue(snapshot);
    service.activateContinuous.mockResolvedValue({ ...snapshot, run: null });
    service.activate24h.mockResolvedValue({ ...snapshot, run: null });
    const { result } = renderHook(() => useLeadDistribution());
    await waitFor(() => expect(result.current.snapshot).not.toBeNull());

    await act(async () => {
      await result.current.applyMode("CONTINUOUS");
    });
    expect(service.activateContinuous).toHaveBeenCalledWith({
      teamId: "team-1",
      departmentId: null,
    });
    await act(async () => {
      await result.current.applyMode("TIME_LIMITED");
    });
    expect(service.activate24h).toHaveBeenCalledWith({ teamId: "team-1", departmentId: null });
  });

  it("two confirms in one frame send one request (duplicate-submit guard)", async () => {
    const snapshot = { status: "PAUSED" as const, policy: null, eligible: [] };
    service.distribution.mockResolvedValue(snapshot);
    let release: (value: unknown) => void = () => {};
    service.activateContinuous.mockReturnValue(new Promise((resolve) => (release = resolve)));
    const { result } = renderHook(() => useLeadDistribution());
    await waitFor(() => expect(result.current.snapshot).not.toBeNull());

    let first: Promise<unknown> = Promise.resolve();
    let second: unknown = "unset";
    await act(async () => {
      first = result.current.applyMode("CONTINUOUS");
      second = await result.current.applyMode("CONTINUOUS");
      release({ ...snapshot, status: "CONTINUOUS", run: null });
      await first;
    });
    expect(second).toBeNull();
    expect(service.activateContinuous).toHaveBeenCalledTimes(1);
  });

  it("a failed save releases the guard so the same mode can be retried", async () => {
    const snapshot = { status: "PAUSED" as const, policy: null, eligible: [] };
    service.distribution.mockResolvedValue(snapshot);
    service.activateContinuous.mockRejectedValueOnce(new Error("boom"));
    service.activateContinuous.mockResolvedValueOnce({ ...snapshot, run: null });
    const { result } = renderHook(() => useLeadDistribution());
    await waitFor(() => expect(result.current.snapshot).not.toBeNull());
    let outcomes: unknown[] = [];
    await act(async () => {
      outcomes = [await result.current.applyMode("CONTINUOUS")];
    });
    expect(outcomes[0]).toBeNull();
    await act(async () => {
      outcomes.push(await result.current.applyMode("CONTINUOUS"));
    });
    expect(outcomes[1]).not.toBeNull();
    expect(service.activateContinuous).toHaveBeenCalledTimes(2);
  });

  it("is loading until the snapshot arrives, and reports a failed read instead of PAUSED", async () => {
    service.distribution.mockRejectedValue(new Error("offline"));
    const { result } = renderHook(() => useLeadDistribution());
    expect(result.current.loading).toBe(true);
    await waitFor(() => expect(result.current.loadFailed).toBe(true));
    expect(result.current.snapshot).toBeNull();
    expect(result.current.loading).toBe(false);
  });
});
