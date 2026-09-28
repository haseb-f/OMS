import { describe, expect, it } from "vitest";
import {
  agentDeclarationAmount,
  buildAgentDeclarationPayload,
  emptyAgentDeclaration,
  validateAgentDeclaration,
  type AgentDeclarationState,
} from "./declaration";

const base = (patch: Partial<AgentDeclarationState> = {}): AgentDeclarationState => ({
  ...emptyAgentDeclaration(new Date(2026, 8, 28)),
  destinationId: "dest-1",
  ...patch,
});

const ctx = { total: 1100, remaining: 600, today: "2026-09-28" };

describe("agent payment declaration", () => {
  it("defaults to a full declaration dated today", () => {
    expect(emptyAgentDeclaration(new Date(2026, 8, 28))).toEqual({
      kind: "FULL",
      amount: "",
      destinationId: "",
      paymentDate: "2026-09-28",
      reference: "",
    });
  });

  it("full = the remaining payable, never re-entered", () => {
    expect(agentDeclarationAmount(base(), 600)).toBe(600);
    expect(agentDeclarationAmount(base({ kind: "UNPAID" }), 600)).toBe(0);
    expect(agentDeclarationAmount(base({ kind: "PARTIAL", amount: "250.555" }), 600)).toBe(250.56);
  });

  it("requires a destination, an amount within the remainder and a past date", () => {
    expect(validateAgentDeclaration(base(), ctx)).toBeNull();
    expect(validateAgentDeclaration(base({ kind: "UNPAID", destinationId: "" }), ctx)).toBeNull();
    expect(validateAgentDeclaration(base({ destinationId: "" }), ctx)).toBe("methodRequired");
    expect(validateAgentDeclaration(base({ kind: "PARTIAL", amount: "" }), ctx)).toBe(
      "amountRequired",
    );
    expect(validateAgentDeclaration(base({ kind: "PARTIAL", amount: "700" }), ctx)).toBe(
      "amountExceeds",
    );
    expect(validateAgentDeclaration(base({ paymentDate: "2026-09-29" }), ctx)).toBe("dateFuture");
    expect(validateAgentDeclaration(base(), { ...ctx, remaining: 0 })).toBe("nothingRemaining");
  });

  it("builds the payload with the idempotency key and staged proof", () => {
    expect(buildAgentDeclarationPayload(base({ kind: "UNPAID" }), ["a"], "k")).toEqual({
      kind: "UNPAID",
      idempotencyKey: "k",
    });
    expect(buildAgentDeclarationPayload(base({ reference: " TX-1 " }), ["a"], "k")).toEqual({
      kind: "FULL",
      destinationId: "dest-1",
      paymentDate: "2026-09-28",
      reference: "TX-1",
      stagedAttachmentIds: ["a"],
      idempotencyKey: "k",
    });
    expect(buildAgentDeclarationPayload(base({ kind: "PARTIAL", amount: "100" }), [], "k")).toEqual(
      {
        kind: "PARTIAL",
        amount: 100,
        destinationId: "dest-1",
        paymentDate: "2026-09-28",
        idempotencyKey: "k",
      },
    );
  });
});
