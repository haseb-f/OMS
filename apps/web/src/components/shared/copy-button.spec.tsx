import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, renderHook, screen } from "@testing-library/react";
import { TooltipProvider } from "@/components/ui/tooltip";
import { messages } from "@/i18n/messages";
import { translate, type MessageKey } from "@/i18n/translate";

const toastSpies = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));
vi.mock("@/lib/toast", () => ({ toast: toastSpies }));
vi.mock("@/providers/locale-provider", () => ({
  useLocale: () => ({
    t: (key: MessageKey, params?: Record<string, string | number>) =>
      translate(messages.en, key, params),
    locale: "en",
    direction: "ltr",
  }),
}));

import { CopyButton } from "./copy-button";
import { useCopyToClipboard, writeClipboardText } from "./use-copy-to-clipboard";

// jsdom has no ResizeObserver; the tooltip (Radix popper) measures with it.
globalThis.ResizeObserver ??= class {
  observe() {}
  unobserve() {}
  disconnect() {}
} as unknown as typeof ResizeObserver;

const writeText = vi.fn<(value: string) => Promise<void>>();

beforeEach(() => {
  writeText.mockReset();
  toastSpies.success.mockReset();
  toastSpies.error.mockReset();
  Object.defineProperty(navigator, "clipboard", {
    configurable: true,
    value: { writeText },
  });
});
afterEach(cleanup);

describe("useCopyToClipboard", () => {
  it("reports copied only after a successful write, then resets", async () => {
    vi.useFakeTimers();
    writeText.mockResolvedValue();
    const { result } = renderHook(() => useCopyToClipboard({ resetAfterMs: 1000 }));
    expect(result.current.copied).toBe(false);
    let ok = false;
    await act(async () => {
      ok = await result.current.copy("ORD-2026-000123");
    });
    expect(ok).toBe(true);
    expect(writeText).toHaveBeenCalledWith("ORD-2026-000123");
    expect(result.current.copied).toBe(true);
    expect(toastSpies.error).not.toHaveBeenCalled();
    act(() => {
      vi.advanceTimersByTime(1000);
    });
    expect(result.current.copied).toBe(false);
    vi.useRealTimers();
  });

  it("never claims success when the write fails — an error toast explains why", async () => {
    writeText.mockRejectedValue(new Error("NotAllowedError"));
    const { result } = renderHook(() => useCopyToClipboard());
    let ok = true;
    await act(async () => {
      ok = await result.current.copy("+201001234567");
    });
    expect(ok).toBe(false);
    expect(result.current.copied).toBe(false);
    expect(toastSpies.error).toHaveBeenCalledWith(
      "Couldn't copy to the clipboard",
      expect.objectContaining({ description: expect.stringContaining("Ctrl+C") }),
    );
  });

  it("does nothing for an empty value", async () => {
    const { result } = renderHook(() => useCopyToClipboard());
    await act(async () => {
      await result.current.copy("");
    });
    expect(writeText).not.toHaveBeenCalled();
  });

  it("confirms with a toast only when asked (surfaces without a button)", async () => {
    writeText.mockResolvedValue();
    const { result } = renderHook(() => useCopyToClipboard({ successToast: "Copied." }));
    await act(async () => {
      await result.current.copy("x");
    });
    expect(toastSpies.success).toHaveBeenCalledWith("Copied.");
  });
});

describe("writeClipboardText", () => {
  it("falls back to execCommand when the Clipboard API is absent (plain-http LAN)", async () => {
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: undefined });
    const execCommand = vi.fn(() => true);
    Object.defineProperty(document, "execCommand", { configurable: true, value: execCommand });
    await writeClipboardText("LD-2026-000001");
    expect(execCommand).toHaveBeenCalledWith("copy");
    // The helper textarea never stays in the page.
    expect(document.querySelector("textarea")).toBeNull();
  });

  it("rejects when no copy path works", async () => {
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: undefined });
    Object.defineProperty(document, "execCommand", { configurable: true, value: () => false });
    await expect(writeClipboardText("x")).rejects.toThrow();
  });
});

describe("CopyButton", () => {
  const renderButton = (ui: React.ReactElement) => render(<TooltipProvider>{ui}</TooltipProvider>);

  it("names what it copies and shows the check + «Copied» only after success", async () => {
    writeText.mockResolvedValue();
    renderButton(<CopyButton value="ORD-1" labelKind="reference" variant="button" />);
    const button = screen.getByRole("button", { name: "Copy reference" });
    expect(button.textContent).toContain("Copy");
    await act(async () => {
      fireEvent.click(button);
    });
    expect(writeText).toHaveBeenCalledWith("ORD-1");
    expect(screen.getByRole("button", { name: "Copied: reference" }).textContent).toContain(
      "Copied",
    );
    expect(screen.getByRole("status").textContent).toBe("Copied: reference");
  });

  it("stays in the copy state after a failed write", async () => {
    writeText.mockRejectedValue(new Error("denied"));
    renderButton(<CopyButton value="+201001234567" labelKind="phone" />);
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Copy phone number" }));
    });
    expect(screen.getByRole("button", { name: "Copy phone number" })).toBeTruthy();
    expect(screen.getByRole("status").textContent).toBe("");
    expect(toastSpies.error).toHaveBeenCalled();
  });

  it("never lets the click reach a clickable row", async () => {
    writeText.mockResolvedValue();
    const onRowClick = vi.fn();
    const onRowDoubleClick = vi.fn();
    renderButton(
      <div onClick={onRowClick} onDoubleClick={onRowDoubleClick}>
        <CopyButton value="REF-9" />
      </div>,
    );
    const button = screen.getByRole("button", { name: "Copy" });
    await act(async () => {
      fireEvent.click(button);
      fireEvent.doubleClick(button);
    });
    expect(onRowClick).not.toHaveBeenCalled();
    expect(onRowDoubleClick).not.toHaveBeenCalled();
  });

  it("is disabled when there is nothing to copy", () => {
    renderButton(<CopyButton value="" />);
    expect((screen.getByRole("button") as HTMLButtonElement).disabled).toBe(true);
  });
});
