import { describe, expect, it } from "vitest";
import { leadStage } from "@/components/crm/lead-stage-indicator";

describe("leadStage", () => {
  it("maps workflow codes onto the four stages", () => {
    expect(leadStage("NEW")).toEqual({ index: 0, closed: false });
    expect(leadStage("IN_PROGRESS")).toEqual({ index: 1, closed: false });
    expect(leadStage("FOLLOW_UP")).toEqual({ index: 1, closed: false });
    expect(leadStage("QUALIFIED")).toEqual({ index: 2, closed: false });
    expect(leadStage("CONVERTED")).toEqual({ index: 3, closed: false });
  });
  it("treats LOST / DISQUALIFIED as closed", () => {
    expect(leadStage("LOST").closed).toBe(true);
    expect(leadStage("DISQUALIFIED").closed).toBe(true);
  });
});
