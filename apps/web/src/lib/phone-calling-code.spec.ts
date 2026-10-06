import { describe, expect, it } from "vitest";
import {
  canProposeCallingCode,
  commitPhoneValue,
  initialOwnedCallingCodeState,
  phoneValueRegion,
  pickCallingCode,
  resolveOwnedCallingCode,
  syncPhoneValue,
} from "./phone-calling-code";
import { applicableProposals } from "@/config/orders/country-entry-defaults";

describe("phone calling code is the phone's own state (R13 A1)", () => {
  it("reads the code back from a stored E.164 — an Egypt address never turns +966 into +20", () => {
    const state = initialOwnedCallingCodeState("+966501234567");
    expect(resolveOwnedCallingCode(state, "+966501234567", "EG")).toBe("SA");
    expect(phoneValueRegion("+201001234567")).toBe("EG");
    expect(phoneValueRegion("0501234567")).toBeNull();
  });

  it("the address country proposes the code only while no code is picked and no number entered", () => {
    let state = initialOwnedCallingCodeState("");
    expect(resolveOwnedCallingCode(state, "", "EG")).toBe("EG");
    expect(resolveOwnedCallingCode(state, "", "AE")).toBe("AE");
    state = pickCallingCode(state, "SA");
    expect(resolveOwnedCallingCode(state, "", "EG")).toBe("SA");
  });

  it("typing a number fixes the code in effect; a later address change keeps it", () => {
    let state = initialOwnedCallingCodeState("");
    // Proposal EG; the user types an invalid draft that is committed raw.
    state = commitPhoneValue(state, "0100", "EG");
    state = syncPhoneValue(state, "0100");
    expect(resolveOwnedCallingCode(state, "0100", "SA")).toBe("EG");
  });

  it("an explicit pick wins over the number's own code until the value changes from outside", () => {
    let state = initialOwnedCallingCodeState("+966501234567");
    state = pickCallingCode(state, "EG");
    expect(resolveOwnedCallingCode(state, "+966501234567", null)).toBe("EG");
    // Another record is loaded into the form: start over from its number.
    state = syncPhoneValue(state, "+971501234567");
    expect(resolveOwnedCallingCode(state, "+971501234567", "EG")).toBe("AE");
  });

  it("our own commit is not mistaken for an outside change", () => {
    let state = pickCallingCode(initialOwnedCallingCodeState(""), "EG");
    state = commitPhoneValue(state, "+201001234567", "EG");
    expect(syncPhoneValue(state, "+201001234567").chosen).toBe("EG");
  });

  it("clearing a typed number lets the proposal apply again; a picked code survives clearing", () => {
    let typed = commitPhoneValue(initialOwnedCallingCodeState(""), "+201001234567", "EG");
    typed = commitPhoneValue(typed, "", "EG");
    expect(resolveOwnedCallingCode(typed, "", "SA")).toBe("SA");
    let picked = pickCallingCode(initialOwnedCallingCodeState(""), "AE");
    picked = commitPhoneValue(picked, "+971501234567", "AE");
    picked = commitPhoneValue(picked, "", "AE");
    expect(resolveOwnedCallingCode(picked, "", "SA")).toBe("AE");
  });

  it("order entry and partner forms share the one proposal rule", () => {
    for (const codeChosen of [true, false]) {
      for (const hasNumber of [true, false]) {
        expect(
          applicableProposals({
            phoneCodeTouched: codeChosen,
            currencyTouched: false,
            phoneHasValue: hasNumber,
          }).phone,
        ).toBe(canProposeCallingCode({ codeChosen, hasNumber }));
      }
    }
  });
});
