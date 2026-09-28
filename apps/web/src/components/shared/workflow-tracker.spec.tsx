import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render } from "@testing-library/react";
import type { ReactNode } from "react";
import { LocaleProvider } from "@/providers/locale-provider";
import { messages } from "@/i18n/messages";
import { WorkflowTracker, WorkflowTracks, resolveWorkflowTrack } from "./workflow-tracker";
import {
  storeOrderFulfillmentTrack,
  storeOrderPaymentTrack,
} from "@/components/store-orders/store-order-workflow-tracks";
import {
  invoiceDocumentTrack,
  invoicePaymentTrack,
} from "@/app/(shell)/sales/invoices/invoice-workflow-tracks";

const wrap = (node: ReactNode) => <LocaleProvider>{node}</LocaleProvider>;
const ar = messages.ar.workflowTracker;
const STAGES = [
  { key: "A", label: "Alpha" },
  { key: "B", label: "Beta" },
  { key: "C", label: "Gamma" },
];

describe("resolveWorkflowTrack", () => {
  it("marks stages before the current one as completed", () => {
    const r = resolveWorkflowTrack({ stages: STAGES, current: "B" });
    expect(r.steps.map((s) => [s.done, s.current])).toEqual([
      [true, false],
      [false, true],
      [false, false],
    ]);
    expect(r.position).toBe(2);
    expect(r.currentLabel).toBe("Beta");
  });

  it("completes the final stage when currentComplete", () => {
    const r = resolveWorkflowTrack({ stages: STAGES, current: "C", currentComplete: true });
    expect(r.steps.every((s) => s.done)).toBe(true);
    expect(r.steps[2].current).toBe(true);
    expect(r.position).toBe(3);
  });

  it("makes an off-path state the current step with no position", () => {
    const r = resolveWorkflowTrack({
      stages: STAGES,
      current: null,
      state: { label: "Cancelled", tone: "destructive" },
    });
    expect(r.steps.some((s) => s.current || s.done)).toBe(false);
    expect(r.position).toBeNull();
    expect(r.currentLabel).toBe("Cancelled");
  });
});

describe("state placement", () => {
  const at = (placement: "before" | "inline" | "after" | undefined, completed: string[]) =>
    resolveWorkflowTrack({
      stages: STAGES,
      current: null,
      completed: new Set(completed),
      state: { label: "S", tone: "neutral", placement },
    }).stateIndex;

  it("draws pre-start states before the first stage", () => {
    expect(at("before", [])).toBe(0);
  });
  it("draws branch states right after the last completed stage", () => {
    expect(at("inline", ["A"])).toBe(1);
    expect(at("inline", [])).toBe(0);
  });
  it("draws terminal states after the stages by default", () => {
    expect(at(undefined, ["A"])).toBe(3);
    expect(at("after", [])).toBe(3);
  });

  it("renders a pre-start state first in the list", () => {
    const { container } = render(
      wrap(
        <WorkflowTracker
          label="Track"
          stages={STAGES}
          current={null}
          state={{ label: "Not ready", tone: "neutral", placement: "before" }}
        />,
      ),
    );
    const items = container.querySelectorAll("ol li");
    expect(items[0].getAttribute("aria-current")).toBe("step");
    expect(items[0].textContent).toContain("Not ready");
    cleanup();
  });
});

describe("WorkflowTracker", () => {
  afterEach(cleanup);

  it("is a read-only ordered list with aria-current and hidden step states", () => {
    const { container } = render(
      wrap(<WorkflowTracker label="Track" stages={STAGES} current="B" />),
    );
    const list = container.querySelector("ol[aria-label=Track]")!;
    const items = list.querySelectorAll("li");
    expect(items).toHaveLength(3);
    expect(items[1].getAttribute("aria-current")).toBe("step");
    expect(items[0].textContent).toContain(ar.completed);
    expect(items[1].textContent).toContain(ar.current);
    expect(items[2].textContent).toContain(ar.upcoming);
    expect(container.querySelector("button, a, [tabindex]")).toBeNull();
    const bar = container.querySelector("[role=progressbar]")!;
    expect(bar.getAttribute("aria-valuenow")).toBe("2");
    expect(container.textContent).toContain(
      ar.position.replace("{position}", "2").replace("{total}", "3"),
    );
  });

  it("renders a terminal state as the current step", () => {
    const { container } = render(
      wrap(
        <WorkflowTracker
          label="Track"
          stages={STAGES}
          current={null}
          state={{ label: "Returned", tone: "warning" }}
        />,
      ),
    );
    const current = container.querySelectorAll("li[aria-current=step]");
    expect(current).toHaveLength(1);
    expect(current[0].textContent).toContain("Returned");
    expect(container.textContent).not.toContain(
      ar.position.replace("{position}", "1").replace("{total}", "3"),
    );
  });

  it("renders independent labeled tracks", () => {
    const { container } = render(
      wrap(
        <WorkflowTracks
          label="Order"
          tracks={[
            { key: "p", label: "Payment", stages: STAGES, current: "A" },
            { key: "f", label: "Fulfillment", stages: STAGES, current: "C" },
          ]}
        />,
      ),
    );
    expect(container.querySelectorAll("h3")).toHaveLength(2);
    expect(container.querySelectorAll("ol")).toHaveLength(2);
  });
});

/** Keys a track actually shows, with marks — through the shared resolver. */
function shown(track: {
  stages: readonly string[];
  optional: readonly string[];
  current: string | null;
  currentComplete: boolean;
  completed?: ReadonlySet<string>;
  stateCode: string | null;
}) {
  const r = resolveWorkflowTrack({
    stages: track.stages.map((key) => ({
      key,
      label: key,
      optional: track.optional.includes(key),
    })),
    current: track.current,
    currentComplete: track.currentComplete,
    completed: track.completed,
    state: track.stateCode ? { label: track.stateCode, tone: "neutral" } : null,
  });
  return r.steps.map((s) => `${s.key}:${s.done ? "done" : s.current ? "current" : "next"}`);
}

describe("optional stages", () => {
  const OPT = [
    { key: "A", label: "A" },
    { key: "B", label: "B", optional: true },
    { key: "C", label: "C" },
  ];

  it("hides an optional stage that is not current (never an unverified done step)", () => {
    const r = resolveWorkflowTrack({ stages: OPT, current: "C", currentComplete: true });
    expect(r.steps.map((s) => s.key)).toEqual(["A", "C"]);
    expect(r.total).toBe(2);
    expect(r.position).toBe(2);
  });

  it("shows an optional stage while it is current", () => {
    const r = resolveWorkflowTrack({ stages: OPT, current: "B" });
    expect(r.steps.map((s) => [s.key, s.done, s.current])).toEqual([
      ["A", true, false],
      ["B", false, true],
      ["C", false, false],
    ]);
    expect(r.position).toBe(2);
  });

  it("shows an optional stage the caller proves was passed", () => {
    const r = resolveWorkflowTrack({ stages: OPT, current: "C", completed: new Set(["A", "B"]) });
    expect(r.steps.map((s) => s.key)).toEqual(["A", "B", "C"]);
  });
});

describe("store order tracks (real status codes)", () => {
  it("never claims Partially paid for an order that is fully paid", () => {
    expect(shown(storeOrderPaymentTrack("FULLY_PAID_RECONCILED"))).toEqual([
      "PAYMENT_PENDING:done",
      "FULLY_PAID_RECONCILED:done",
    ]);
    expect(shown(storeOrderPaymentTrack("PARTIALLY_PAID"))).toEqual([
      "PAYMENT_PENDING:done",
      "PARTIALLY_PAID:current",
      "FULLY_PAID_RECONCILED:next",
    ]);
    expect(shown(storeOrderPaymentTrack("PAYMENT_PENDING"))).toEqual([
      "PAYMENT_PENDING:current",
      "FULLY_PAID_RECONCILED:next",
    ]);
  });

  it("shows off-path payment states after the creation stage only", () => {
    for (const code of ["OVERPAID", "PAYMENT_REVIEW", "UNMATCHED"] as const) {
      const track = storeOrderPaymentTrack(code);
      expect(track.stateCode).toBe(code);
      expect(track.statePlacement).toBe(code === "OVERPAID" ? "after" : "inline");
      expect(shown(track)).toEqual(["PAYMENT_PENDING:done", "FULLY_PAID_RECONCILED:next"]);
    }
  });

  it("maps shipping fulfillment; Ready is optional (orders can start Unfulfilled)", () => {
    const ship = (code: string | null, stage: "NOT_READY" | "READY_FOR_SHIPPING" = "NOT_READY") =>
      storeOrderFulfillmentTrack({
        fulfillmentMethod: "SHIPPING",
        shippingStage: stage,
        fulfillmentStatus: code ? { id: "x", code, name: code } : null,
      });
    expect(shown(ship("DELIVERED"))).toEqual(["SHIPPED:done", "DELIVERED:done"]);
    expect(shown(ship("SHIPPED"))).toEqual(["SHIPPED:current", "DELIVERED:next"]);
    expect(shown(ship(null, "READY_FOR_SHIPPING"))).toEqual([
      "READY:current",
      "SHIPPED:next",
      "DELIVERED:next",
    ]);
    expect(ship(null)).toMatchObject({ stateCode: "UNFULFILLED", statePlacement: "before" });
    expect(ship("PROCESSING").statePlacement).toBe("inline");
    expect(ship("CANCELLED").statePlacement).toBe("after");
    expect(shown(ship("PROCESSING"))).toEqual(["SHIPPED:next", "DELIVERED:next"]);
    expect(ship("CANCELLED")).toMatchObject({ current: null, stateCode: "CANCELLED" });
  });

  it("maps pickup; every pickup step is enforced by the API", () => {
    const pickup = (code: string) =>
      storeOrderFulfillmentTrack({
        fulfillmentMethod: "PICKUP",
        shippingStage: "NOT_READY",
        fulfillmentStatus: { id: "x", code, name: code },
      });
    expect(shown(pickup("COLLECTED"))).toEqual([
      "AWAITING_PREPARATION:done",
      "READY_FOR_PICKUP:done",
      "COLLECTED:done",
    ]);
    expect(pickup("RETURNED")).toMatchObject({ currentComplete: true, stateCode: "RETURNED" });
  });
});

describe("sales invoice tracks (real status codes)", () => {
  it("shows only Confirmed as certain for a confirmed invoice", () => {
    // Confirm may approve implicitly from DRAFT; store-order invoices are created CONFIRMED.
    expect(shown(invoiceDocumentTrack("CONFIRMED"))).toEqual(["CONFIRMED:done"]);
    expect(shown(invoiceDocumentTrack("DELIVERED"))).toEqual(["CONFIRMED:done"]);
  });

  it("shows Draft/Approved only when current or proven passed", () => {
    expect(shown(invoiceDocumentTrack("DRAFT"))).toEqual(["DRAFT:current", "CONFIRMED:next"]);
    expect(shown(invoiceDocumentTrack("APPROVED"))).toEqual([
      "DRAFT:done",
      "APPROVED:current",
      "CONFIRMED:next",
    ]);
    const pending = invoiceDocumentTrack("PENDING_APPROVAL");
    expect(pending).toMatchObject({ stateCode: "PENDING_APPROVAL", statePlacement: "inline" });
    expect(shown(pending)).toEqual(["DRAFT:done", "CONFIRMED:next"]);
    expect(invoiceDocumentTrack("CANCELLED").stateCode).toBe("CANCELLED");
    expect(shown(invoiceDocumentTrack("CLOSED"))).toEqual(["CONFIRMED:next"]);
  });

  it("never claims Partially paid for a paid invoice", () => {
    expect(shown(invoicePaymentTrack("PAID"))).toEqual(["UNPAID:done", "PAID:done"]);
    expect(shown(invoicePaymentTrack("PARTIALLY_PAID"))).toEqual([
      "UNPAID:done",
      "PARTIALLY_PAID:current",
      "PAID:next",
    ]);
    expect(invoicePaymentTrack("CANCELLED").stateCode).toBe("CANCELLED");
  });
});
