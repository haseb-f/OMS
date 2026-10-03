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

  it("is loading until the snapshot arrives, and reports a failed read instead of PAUSED", async () => {
    service.distribution.mockRejectedValue(new Error("offline"));
    const { result } = renderHook(() => useLeadDistribution());
    expect(result.current.loading).toBe(true);
    await waitFor(() => expect(result.current.loadFailed).toBe(true));
    expect(result.current.snapshot).toBeNull();
    expect(result.current.loading).toBe(false);
  });
});
