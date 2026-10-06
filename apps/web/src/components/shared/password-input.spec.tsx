import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { TooltipProvider } from "@/components/ui/tooltip";
import { messages } from "@/i18n/messages";
import { translate, type MessageKey } from "@/i18n/translate";

const toastSuccess = vi.fn();
vi.mock("@/lib/toast", () => ({
  toast: { success: (...args: unknown[]) => toastSuccess(...args), error: vi.fn() },
}));
vi.mock("@/providers/locale-provider", () => ({
  useLocale: () => ({
    t: (key: MessageKey, params?: Record<string, string | number>) =>
      translate(messages.en, key, params),
    locale: "en",
    direction: "ltr",
  }),
}));

import { PasswordInput } from "./password-input";
import { PASSWORD_POLICY } from "@/lib/password-generator";

// jsdom has no ResizeObserver; the tooltip (Radix popper) measures with it.
globalThis.ResizeObserver ??= class {
  observe() {}
  unobserve() {}
  disconnect() {}
} as unknown as typeof ResizeObserver;

const writeText = vi.fn<(value: string) => Promise<void>>();
beforeEach(() => {
  writeText.mockReset().mockResolvedValue();
  Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText } });
});
afterEach(cleanup);

function Controlled(props: {
  autoComplete?: string;
  generatable?: boolean;
  onGenerated?: (password: string) => void;
}) {
  const [value, setValue] = useState("");
  return (
    <PasswordInput
      aria-label="Password"
      value={value}
      onChange={(event) => setValue(event.target.value)}
      {...props}
    />
  );
}

const renderField = (ui: React.ReactElement) => render(<TooltipProvider>{ui}</TooltipProvider>);
const field = () => screen.getByLabelText("Password") as HTMLInputElement;

describe("PasswordInput", () => {
  it("is masked by default and keeps the caller's autocomplete", () => {
    renderField(<Controlled autoComplete="current-password" />);
    expect(field().type).toBe("password");
    expect(field().getAttribute("autocomplete")).toBe("current-password");
    expect(field().getAttribute("dir")).toBe("ltr");
  });

  it("Show/Hide toggles the mask with a pressed state", () => {
    renderField(<Controlled />);
    const show = screen.getByRole("button", { name: "Show password" });
    expect(show.getAttribute("aria-pressed")).toBe("false");
    fireEvent.click(show);
    expect(field().type).toBe("text");
    const hide = screen.getByRole("button", { name: "Hide password" });
    expect(hide.getAttribute("aria-pressed")).toBe("true");
    fireEvent.click(hide);
    expect(field().type).toBe("password");
  });

  it("copies exactly what is typed, and only once something is typed", async () => {
    renderField(<Controlled autoComplete="new-password" />);
    const copy = screen.getByRole("button", { name: "Copy password" }) as HTMLButtonElement;
    expect(copy.disabled).toBe(true);
    fireEvent.change(field(), { target: { value: "S3cret!pass" } });
    expect(copy.disabled).toBe(false);
    await act(async () => {
      fireEvent.click(copy);
    });
    expect(writeText).toHaveBeenCalledWith("S3cret!pass");
    expect(screen.getByRole("button", { name: "Copied: password" })).toBeTruthy();
    // Copying never unmasks the field.
    expect(field().type).toBe("password");
  });

  it("works uncontrolled (value read from the field at click time)", async () => {
    renderField(<PasswordInput aria-label="Password" />);
    fireEvent.change(field(), { target: { value: "typed-now" } });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Copy password" }));
    });
    expect(writeText).toHaveBeenCalledWith("typed-now");
  });

  it("allows paste (no handler blocks it)", () => {
    renderField(<Controlled />);
    const event = new Event("paste", { bubbles: true, cancelable: true });
    field().dispatchEvent(event);
    expect(event.defaultPrevented).toBe(false);
  });

  it("can hide the Copy action", () => {
    renderField(<PasswordInput aria-label="Password" copyable={false} />);
    expect(screen.queryByRole("button", { name: "Copy password" })).toBeNull();
  });

  it("copy also confirms with a 'Password copied' toast", async () => {
    toastSuccess.mockReset();
    renderField(<Controlled />);
    fireEvent.change(field(), { target: { value: "S3cret!pass" } });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Copy password" }));
    });
    expect(toastSuccess).toHaveBeenCalledWith("Password copied");
  });

  it("Generate is opt-in", () => {
    renderField(<Controlled />);
    expect(screen.queryByRole("button", { name: "Generate a strong password" })).toBeNull();
  });

  it("Generate fills a policy-compliant password through onChange, reveals it, then offers Regenerate", () => {
    const onGenerated = vi.fn();
    renderField(<Controlled generatable onGenerated={onGenerated} />);
    fireEvent.click(screen.getByRole("button", { name: "Generate a strong password" }));
    const first = field().value;
    expect(first).toHaveLength(PASSWORD_POLICY.generatedLength);
    expect(onGenerated).toHaveBeenCalledWith(first);
    expect(field().type).toBe("text");
    fireEvent.click(screen.getByRole("button", { name: "Generate another password" }));
    expect(field().value).toHaveLength(PASSWORD_POLICY.generatedLength);
    expect(field().value).not.toBe(first);
  });
});
