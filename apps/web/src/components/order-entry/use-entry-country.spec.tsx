import { describe, expect, it, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { useEntryCountry } from "./use-entry-country";

/**
 * R11 / R12 / R16 S3 — the customer's country proposes the phone's calling
 * code; the code stays its own choice; a manual code (or a number already
 * typed under one) is never reset by a later country change. Both adapters
 * call this one hook: the agent adapter without currencies (every agent
 * order is in the agent's settlement currency), the company adapter with
 * the currency proposal. Each case runs under both configurations.
 */

const countries = [
  { id: "sa", code: "SA", defaultCurrencyId: "sar" },
  { id: "eg", code: "EG", defaultCurrencyId: "egp" },
  { id: "ae", code: "AE", defaultCurrencyId: null },
  { id: "kw", code: "KW", defaultCurrencyId: null },
];
const currencies = [{ id: "sar" }, { id: "egp" }, { id: "usd" }];

interface Props {
  countryId: string;
  phone: string;
}

/** The hook exactly as each adapter wires it. */
function setup(adapter: "agent" | "company", initial: Props = { countryId: "", phone: "" }) {
  const phoneCountryCodeRef = { current: null as string | null };
  const state = { phone: initial.phone, currencyId: "" };
  const onProposeCurrency = vi.fn((id: string) => {
    state.currencyId = id;
  });
  const hook = renderHook(
    ({ countryId }: Props) =>
      useEntryCountry({
        countryId,
        phoneCountryCodeRef,
        countries,
        getPhone: () => state.phone,
        ...(adapter === "company"
          ? { currencies, currencyId: state.currencyId, onProposeCurrency }
          : { defaultCountryId: null }),
      }),
    { initialProps: initial },
  );
  /** The user picks a customer country (the combobox calls `onCountryChosen`, then the value changes). */
  const chooseCountry = (countryId: string) => {
    act(() => hook.result.current.onCountryChosen());
    hook.rerender({ countryId, phone: state.phone });
  };
  const typePhone = (phone: string) => {
    state.phone = phone;
  };
  return { hook, phoneCountryCodeRef, chooseCountry, typePhone, state, onProposeCurrency };
}

describe.each(["agent", "company"] as const)("useEntryCountry — %s adapter", (adapter) => {
  it("uses the O2 default calling code (SA) until a country is chosen", () => {
    const { hook, phoneCountryCodeRef } = setup(adapter);
    expect(hook.result.current.phoneCountryCode).toBe("SA");
    expect(phoneCountryCodeRef.current).toBe("SA");
  });

  it("choosing the customer's country proposes its calling code, and a later country change proposes again", () => {
    const { hook, phoneCountryCodeRef, chooseCountry } = setup(adapter);
    chooseCountry("eg");
    expect(hook.result.current.phoneCountryCode).toBe("EG");
    expect(phoneCountryCodeRef.current).toBe("EG");
    chooseCountry("ae");
    expect(hook.result.current.phoneCountryCode).toBe("AE");
    expect(hook.result.current.phoneCountryOverride).toBeNull();
  });

  it("the calling code stays independently editable and a manual choice survives later country changes", () => {
    const { hook, phoneCountryCodeRef, chooseCountry } = setup(adapter);
    chooseCountry("eg");
    act(() => hook.result.current.selectPhoneCode("KW"));
    expect(hook.result.current.phoneCountryCode).toBe("KW");
    chooseCountry("ae");
    expect(hook.result.current.phoneCountryCode).toBe("KW");
    chooseCountry("sa");
    expect(hook.result.current.phoneCountryCode).toBe("KW");
    expect(phoneCountryCodeRef.current).toBe("KW");
  });

  it("a number already typed keeps the code it was read with when the country changes", () => {
    const { hook, chooseCountry, typePhone } = setup(adapter);
    chooseCountry("eg");
    typePhone("1001234567");
    chooseCountry("ae");
    expect(hook.result.current.phoneCountryCode).toBe("EG");
    expect(hook.result.current.phoneCountryOverride).toBe("eg");
  });

  it("an unknown code is ignored (the current code is kept)", () => {
    const { hook, chooseCountry } = setup(adapter);
    chooseCountry("eg");
    act(() => hook.result.current.selectPhoneCode("ZZ"));
    expect(hook.result.current.phoneCountryCode).toBe("EG");
  });

  it("an existing customer's saved phone keeps its own country when it differs from the customer's country", () => {
    const { hook } = setup(adapter);
    expect(hook.result.current.phoneCountryOverrideFor("+971501234567", "eg")).toBe("ae");
    // Same country as the customer: nothing to override.
    expect(hook.result.current.phoneCountryOverrideFor("+201001234567", "eg")).toBeNull();
    expect(hook.result.current.phoneCountryOverrideFor("", "eg")).toBeNull();
  });
});

describe("useEntryCountry — adapter differences", () => {
  it("company: the country also proposes the order currency; agent: no currency proposal", () => {
    const company = setup("company");
    company.chooseCountry("eg");
    expect(company.onProposeCurrency).toHaveBeenLastCalledWith("egp");

    const agent = setup("agent");
    agent.chooseCountry("eg");
    expect(agent.onProposeCurrency).not.toHaveBeenCalled();
    expect(agent.hook.result.current.noCurrencyDefault).toBe(false);
  });

  it("company: a manually chosen currency is never overwritten by a later country change", () => {
    const company = setup("company");
    company.chooseCountry("eg");
    company.onProposeCurrency.mockClear();
    act(() => company.hook.result.current.markCurrencyTouched());
    company.chooseCountry("sa");
    expect(company.onProposeCurrency).not.toHaveBeenCalled();
  });

  it("agent: a single offered destination country is applied as the default without asking", () => {
    const onDefaultCountry = vi.fn();
    renderHook(() =>
      useEntryCountry({
        countryId: "",
        phoneCountryCodeRef: { current: null },
        countries: [countries[1]],
        getPhone: () => "",
        defaultCountryId: "eg",
        onDefaultCountry,
      }),
    );
    expect(onDefaultCountry).toHaveBeenCalledWith("eg");
  });
});
