import { afterEach, describe, expect, it, vi } from "vitest";
import { isValidElement, type ReactElement } from "react";
import { toast as sonnerToast } from "sonner";
import {
  destructiveDoneOptions,
  errorToastOptions,
  reportApiError,
  reportDestructiveDone,
  TOAST_DURATIONS,
  TOAST_PERSISTENT,
  toastSemantics,
  toast,
} from "./toast";
import { messages } from "@/i18n/messages";

describe("toastSemantics (variant → role / aria-live / duration)", () => {
  it("success is a polite status that auto-dismisses", () => {
    expect(toastSemantics("success")).toEqual({
      role: "status",
      ariaLive: "polite",
      duration: TOAST_DURATIONS.success,
      closeButton: false,
    });
  });

  it("error is an assertive alert with a close button and a longer lifetime", () => {
    const s = toastSemantics("error");
    expect(s.role).toBe("alert");
    expect(s.ariaLive).toBe("assertive");
    expect(s.closeButton).toBe(true);
    expect(s.duration).toBeGreaterThan(TOAST_DURATIONS.success);
  });

  it("a confirmed destructive outcome is red but polite — nothing failed", () => {
    const s = toastSemantics("destructive");
    expect(s.role).toBe("status");
    expect(s.ariaLive).toBe("polite");
  });

  it("warning / info are polite", () => {
    expect(toastSemantics("warning").ariaLive).toBe("polite");
    expect(toastSemantics("info").role).toBe("status");
  });

  it("persistent (critical / actionable) never auto-dismisses and is closable", () => {
    const s = toastSemantics("error", true);
    expect(s.duration).toBe(TOAST_PERSISTENT);
    expect(s.closeButton).toBe(true);
  });
});

describe("toast wrappers", () => {
  afterEach(() => {
    window.localStorage.clear();
    vi.restoreAllMocks();
  });

  it("errorToastOptions: a Retry action makes the toast persistent", () => {
    const onRetry = vi.fn();
    const options = errorToastOptions({ onRetry });
    expect(options.duration).toBe(TOAST_PERSISTENT);
    const action = options.action as { label: string; onClick: () => void };
    expect(action.label).toBe(messages.ar.toast.retry);
    action.onClick();
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it("errorToastOptions: critical is persistent without an action; plain errors keep the default", () => {
    expect(errorToastOptions({ critical: true }).duration).toBe(TOAST_PERSISTENT);
    expect(errorToastOptions({ critical: true }).action).toBeUndefined();
    expect("duration" in errorToastOptions()).toBe(false);
    expect(errorToastOptions({ duration: 1234 }).duration).toBe(1234);
  });

  it("reportApiError forwards retry into one error toast", () => {
    const spy = vi.spyOn(toast, "error").mockImplementation(() => 1);
    reportApiError(new Error("x"), "errors.saveFailed", { onRetry: () => {} });
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy.mock.calls[0][0]).toBe(messages.ar.errors.saveFailed);
    expect(spy.mock.calls[0][1]?.duration).toBe(TOAST_PERSISTENT);
  });

  it("destructiveDoneOptions: red class, own icon, destructive duration", () => {
    const options = destructiveDoneOptions({ description: "SO-1" });
    expect(options.className).toBe("oms-toast-destructive");
    expect(options.duration).toBe(TOAST_DURATIONS.destructive);
    expect(options.description).toBe("SO-1");
    expect(isValidElement(options.icon)).toBe(true);
  });

  type Recorded = {
    id: string | number;
    title?: unknown;
    duration?: number;
    type?: string;
    className?: string;
    closeButton?: boolean;
  };
  const recorded = (id: string | number) =>
    (sonnerToast.getHistory() as Recorded[]).find((item) => item.id === id);
  const liveProps = (title: unknown) => {
    expect(isValidElement(title)).toBe(true);
    return (title as ReactElement<Record<string, unknown>>).props;
  };

  it("success / error wrappers announce with the tone's live-region role and default duration", () => {
    const success = recorded(toast.success("Saved"));
    const failure = recorded(toast.error("Failed"));
    expect(liveProps(success?.title).role).toBe("status");
    expect(liveProps(success?.title)["aria-live"]).toBe("polite");
    expect(success?.duration).toBe(TOAST_DURATIONS.success);
    expect(liveProps(failure?.title).role).toBe("alert");
    expect(liveProps(failure?.title)["aria-live"]).toBe("assertive");
    expect(failure?.duration).toBe(TOAST_DURATIONS.error);
    expect(failure?.closeButton).toBe(true);
  });

  it("reportDestructiveDone raises a polite red toast, not an error toast", () => {
    const error = vi.spyOn(toast, "error");
    const done = recorded(reportDestructiveDone("Order cancelled"));
    expect(error).not.toHaveBeenCalled();
    expect(done?.type).not.toBe("error");
    expect(done?.className).toBe("oms-toast-destructive");
    expect(liveProps(done?.title).role).toBe("status");
  });
});
