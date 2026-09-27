import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render } from "@testing-library/react";
import type { ReactNode } from "react";
import { LocaleProvider } from "@/providers/locale-provider";
import { ApiError } from "@/services/api-client";
import { messages } from "@/i18n/messages";
import {
  FormErrorSummary,
  applyServerFieldErrors,
  focusFirstInvalidIn,
  formErrorsFromRhf,
  type FormErrorItem,
} from "./form-error-summary";

const wrap = (node: ReactNode) => <LocaleProvider>{node}</LocaleProvider>;

function Harness({ errors }: { errors: FormErrorItem[] }) {
  return (
    <form>
      <FormErrorSummary errors={errors} />
      <div
        data-field-name="code"
        data-invalid={errors.some((e) => e.fieldId === "code") || undefined}
      >
        <input aria-label="code" aria-invalid={errors.some((e) => e.fieldId === "code")} />
      </div>
      <div data-field-name="name">
        <input aria-label="name" aria-invalid={errors.some((e) => e.fieldId === "name")} />
      </div>
    </form>
  );
}

describe("FormErrorSummary", () => {
  afterEach(() => {
    cleanup();
    window.localStorage.clear();
  });

  it("renders no banner while there are no errors", () => {
    const { container } = render(wrap(<Harness errors={[]} />));
    expect(container.querySelector("[data-slot=alert]")).toBeNull();
  });

  it("lists every problem, announces politely, and never steals focus", () => {
    const errors: FormErrorItem[] = [
      { fieldId: "code", label: "Code", message: "Required." },
      { fieldId: "name", label: "Name", message: "Too long." },
    ];
    const { container, getByText } = render(wrap(<Harness errors={errors} />));
    const alert = container.querySelector("[data-slot=alert]")!;
    expect(alert).toBeTruthy();
    // Polite live region, not an assertive role=alert that interrupts.
    expect(alert.getAttribute("role")).toBeNull();
    const live = container.querySelector("[aria-live=polite]")!;
    expect(live.textContent).toBe(messages.ar.feedback.formErrors.announce.replace("{count}", "2"));
    expect(getByText(/Required\./)).toBeTruthy();
    expect(document.activeElement).toBe(document.body);
  });

  it("focuses the related field when an item is activated", () => {
    const errors: FormErrorItem[] = [{ fieldId: "name", label: "Name", message: "Too long." }];
    const { getByText, getByLabelText } = render(wrap(<Harness errors={errors} />));
    fireEvent.click(getByText(/Too long\./).closest("button")!);
    expect(document.activeElement).toBe(getByLabelText("name"));
  });

  it("disappears once the errors are fixed, clearing the live region", () => {
    const errors: FormErrorItem[] = [{ fieldId: "code", message: "Required." }];
    const view = render(wrap(<Harness errors={errors} />));
    view.rerender(wrap(<Harness errors={[]} />));
    expect(view.container.querySelector("[data-slot=alert]")).toBeNull();
    expect(view.container.querySelector("[aria-live=polite]")!.textContent).toBe("");
  });

  it("renders a form-level item (no field) as plain text", () => {
    const { container } = render(wrap(<Harness errors={[{ message: "Server down." }]} />));
    const alert = container.querySelector("[data-slot=alert]")!;
    expect(alert.textContent).toContain("Server down.");
    expect(alert.querySelector("button")).toBeNull();
  });
});

describe("focusFirstInvalidIn", () => {
  afterEach(cleanup);

  it("focuses the first invalid control in DOM order", () => {
    const { container, getByLabelText } = render(
      <div>
        <input aria-label="a" />
        <input aria-label="b" aria-invalid="true" />
        <input aria-label="c" aria-invalid="true" />
      </div>,
    );
    expect(focusFirstInvalidIn(container)).toBe(true);
    expect(document.activeElement).toBe(getByLabelText("b"));
  });

  it("reaches a custom control through its data-invalid wrapper", () => {
    const { container, getByRole } = render(
      <div>
        <div data-invalid="true">
          <button type="button">Pick country</button>
        </div>
      </div>,
    );
    act(() => {
      focusFirstInvalidIn(container);
    });
    expect(document.activeElement).toBe(getByRole("button"));
  });

  it("returns false when nothing is invalid", () => {
    const { container } = render(<input aria-label="ok" />);
    expect(focusFirstInvalidIn(container)).toBe(false);
  });
});

describe("formErrorsFromRhf", () => {
  it("flattens nested errors and keeps form order", () => {
    const items = formErrorsFromRhf(
      {
        name: { type: "required", message: "Name required" },
        code: { type: "required", message: "Code required" },
        address: { city: { type: "min", message: "City short" } },
      } as never,
      {
        order: ["code", "name", "address"],
        labelFor: (n) =>
          (({ code: "CODE", name: "NAME", address: "ADDRESS" }) as Record<string, string>)[n],
      },
    );
    expect(items.map((i) => i.fieldId)).toEqual(["code", "name", "address.city"]);
    expect(items[0].label).toBe("CODE");
    expect(items[2].label).toBe("ADDRESS");
  });
});

describe("applyServerFieldErrors", () => {
  it("attaches a single field problem inline with the server's own message", () => {
    const setError = vi.fn();
    const error = new ApiError(409, "Code already used.", "DUPLICATE", [
      { field: "code", constraints: ["unique"] },
    ]);
    const rest = applyServerFieldErrors(error, setError, { knownFields: ["code", "name"] });
    expect(rest).toEqual([]);
    expect(setError).toHaveBeenCalledWith(
      "code",
      { type: "server", message: "Code already used." },
      { shouldFocus: false },
    );
  });

  it("gives each of several fields its own short message", () => {
    const setError = vi.fn();
    const error = new ApiError(400, "x", "VALIDATION_ERROR", [
      { field: "code", constraints: ["unique"] },
      { field: "name", constraints: ["name should not be empty"] },
    ]);
    applyServerFieldErrors(error, setError, { knownFields: ["code", "name"] });
    expect(setError.mock.calls.map((c) => c[1].message)).toEqual([
      messages.ar.feedback.server.duplicate,
      messages.ar.feedback.server.required,
    ]);
  });

  it("returns a form-level item when the problem can't be tied to a field", () => {
    const setError = vi.fn();
    const rest = applyServerFieldErrors(
      new ApiError(400, "Period is closed.", "VALIDATION_ERROR"),
      setError,
      { knownFields: ["code"] },
    );
    expect(setError).not.toHaveBeenCalled();
    expect(rest).toEqual([{ message: "Period is closed." }]);
  });
});
