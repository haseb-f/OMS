import { describe, expect, it } from "vitest";
import { parseTriggerTrial, resolveTriggerTrial } from "./trigger-trial";

const base = { env: undefined, development: true, query: null, stored: null };

describe("dropdown-trigger trial switch (Round 6, local only)", () => {
  it("accepts only a or b", () => {
    expect(parseTriggerTrial("A")).toBe("a");
    expect(parseTriggerTrial(" b ")).toBe("b");
    expect(parseTriggerTrial("c")).toBeNull();
    expect(parseTriggerTrial(undefined)).toBeNull();
  });

  it("defaults to the canonical design when nothing is set", () => {
    expect(resolveTriggerTrial(base)).toEqual({ trial: null, store: null });
  });

  it("never honours the query or a stored choice outside development", () => {
    expect(resolveTriggerTrial({ ...base, development: false, query: "a", stored: "b" })).toEqual({
      trial: null,
      store: null,
    });
  });

  it("lets the env variable win everywhere", () => {
    expect(resolveTriggerTrial({ ...base, development: false, env: "b" }).trial).toBe("b");
    expect(resolveTriggerTrial({ ...base, env: "a", query: "b" }).trial).toBe("a");
  });

  it("in development, the query sets the tab's trial and `off` clears it", () => {
    expect(resolveTriggerTrial({ ...base, query: "b" })).toEqual({ trial: "b", store: "b" });
    expect(resolveTriggerTrial({ ...base, query: "off", stored: "a" })).toEqual({
      trial: null,
      store: "clear",
    });
    expect(resolveTriggerTrial({ ...base, stored: "a" })).toEqual({ trial: "a", store: null });
  });
});
