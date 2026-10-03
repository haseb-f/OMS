import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  LEAD_FOLLOW_UP_OUTCOMES,
  FOLLOW_UP_OUTCOME_TONE,
  followUpOutcomeLabel,
} from "@/config/crm/follow-up-outcomes";
import ar from "@/i18n/messages/ar";
import en from "@/i18n/messages/en";

/** The API owns the list; this mirror must carry exactly the same codes, in order. */
function apiOutcomeCodes(): string[] {
  const source = readFileSync(
    // vitest runs from apps/web (jsdom: import.meta.url is not a file URL).
    resolve(process.cwd(), "../api/src/leads/follow-up-outcomes.ts"),
    "utf8",
  );
  const body = source.match(/LEAD_FOLLOW_UP_OUTCOMES = \[([\s\S]*?)\] as const/);
  if (!body) throw new Error("LEAD_FOLLOW_UP_OUTCOMES not found in the API file");
  return [...body[1].matchAll(/'([^']+)'/g)].map((match) => match[1]);
}

describe("follow-up outcomes", () => {
  it("mirrors the server-owned list exactly", () => {
    expect([...LEAD_FOLLOW_UP_OUTCOMES]).toEqual(apiOutcomeCodes());
  });

  it("every code has a tone and an Arabic + English label", () => {
    for (const code of LEAD_FOLLOW_UP_OUTCOMES) {
      expect(FOLLOW_UP_OUTCOME_TONE[code]).toBeTruthy();
      expect(ar.crm.leads.followUp.outcomes[code]).toBeTruthy();
      expect(en.crm.leads.followUp.outcomes[code]).toBeTruthy();
    }
  });

  it("translates known codes and shows legacy free text as typed", () => {
    const t = (key: string) => `t:${key}`;
    expect(followUpOutcomeLabel("noAnswer", t)).toBe("t:crm.leads.followUp.outcomes.noAnswer");
    expect(followUpOutcomeLabel("qualified soon", t)).toBe("qualified soon");
    expect(followUpOutcomeLabel(null, t)).toBe("");
  });
});
