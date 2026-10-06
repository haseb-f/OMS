import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render } from "@testing-library/react";
import type { ReactNode } from "react";
import { LocaleProvider } from "@/providers/locale-provider";
import { messages } from "@/i18n/messages";
import { StepFlow, StepFlowFooter } from "./step-flow";

const wrap = (node: ReactNode) => <LocaleProvider>{node}</LocaleProvider>;
const ar = messages.ar;
const steps = [
  { id: "a", label: "Customer" },
  { id: "b", label: "Products" },
  { id: "c", label: "Delivery" },
  { id: "d", label: "Review" },
];

describe("StepFlow", () => {
  afterEach(cleanup);

  it("marks completed / current / upcoming steps in an ordered list", () => {
    const { container } = render(wrap(<StepFlow steps={steps} currentIndex={1} />));
    const items = container.querySelectorAll("ol > li");
    expect(items).toHaveLength(4);
    expect([...items].map((item) => item.getAttribute("data-state"))).toEqual([
      "complete",
      "current",
      "upcoming",
      "upcoming",
    ]);
    const current = container.querySelectorAll('[aria-current="step"]');
    expect(current).toHaveLength(1);
    expect(current[0].textContent).toContain("Products");
    expect(container.querySelector("nav")?.getAttribute("aria-label")).toBe(
      ar.common.stepFlow.label,
    );
  });

  it("shows the compact 'step X of N · label' line for narrow screens", () => {
    const { getByTestId } = render(wrap(<StepFlow steps={steps} currentIndex={1} />));
    const text = getByTestId("step-flow-compact").textContent ?? "";
    expect(text).toContain(
      ar.common.stepFlow.progress.replace("{current}", "2").replace("{total}", "4"),
    );
    expect(text).toContain("Products");
  });

  it("lets completed steps go back, never forward", () => {
    const onStepSelect = vi.fn();
    const { container } = render(
      wrap(<StepFlow steps={steps} currentIndex={2} onStepSelect={onStepSelect} />),
    );
    const buttons = container.querySelectorAll("ol button");
    expect(buttons).toHaveLength(2);
    fireEvent.click(buttons[0]);
    expect(onStepSelect).toHaveBeenCalledWith(0);
    expect(container.querySelector('[data-state="upcoming"] button')).toBeNull();
  });

  it("is read-only without onStepSelect", () => {
    const { container } = render(wrap(<StepFlow steps={steps} currentIndex={3} />));
    expect(container.querySelectorAll("ol button")).toHaveLength(0);
  });
});

describe("StepFlowFooter", () => {
  afterEach(cleanup);

  const base = {
    stepCount: 4,
    onBack: vi.fn(),
    onNext: vi.fn(),
    onFinal: vi.fn(),
    requestClose: vi.fn(),
    finalLabel: "Create",
  };

  it("first step: Cancel + Next, no Back, no final action", () => {
    const { queryByText, getByTestId, queryByTestId } = render(
      wrap(<StepFlowFooter {...base} currentIndex={0} />),
    );
    expect(queryByText(ar.common.back)).toBeNull();
    expect(queryByTestId("step-flow-final")).toBeNull();
    fireEvent.click(getByTestId("step-flow-next"));
    expect(base.onNext).toHaveBeenCalledTimes(1);
    fireEvent.click(queryByText(ar.common.cancel)!);
    expect(base.requestClose).toHaveBeenCalledTimes(1);
  });

  it("middle step: Back + Next", () => {
    const onBack = vi.fn();
    const { getByText, getByTestId } = render(
      wrap(<StepFlowFooter {...base} onBack={onBack} currentIndex={1} />),
    );
    fireEvent.click(getByText(ar.common.back));
    expect(onBack).toHaveBeenCalledTimes(1);
    expect(getByTestId("step-flow-next")).toBeTruthy();
  });

  it("last step: the final action replaces Next and is disabled while submitting", () => {
    const { getByTestId, queryByTestId, rerender } = render(
      wrap(<StepFlowFooter {...base} currentIndex={3} />),
    );
    expect(queryByTestId("step-flow-next")).toBeNull();
    const final = getByTestId("step-flow-final") as HTMLButtonElement;
    expect(final.type).toBe("button");
    expect(final.textContent).toContain("Create");
    expect(final.disabled).toBe(false);
    rerender(wrap(<StepFlowFooter {...base} currentIndex={3} isSubmitting />));
    expect((getByTestId("step-flow-final") as HTMLButtonElement).disabled).toBe(true);
  });

  it("never renders a submit-type button (Enter cannot submit or skip)", () => {
    const { container } = render(wrap(<StepFlowFooter {...base} currentIndex={3} />));
    expect(container.querySelector('button[type="submit"]')).toBeNull();
  });
});
