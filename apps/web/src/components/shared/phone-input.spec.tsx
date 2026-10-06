import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { messages } from "@/i18n/messages";
import { translate, type MessageKey } from "@/i18n/translate";

vi.mock("@/providers/locale-provider", () => ({
  useLocale: () => ({
    t: (key: MessageKey, params?: Record<string, string | number>) =>
      translate(messages.en, key, params),
    locale: "en",
    direction: "ltr",
  }),
}));

import { OMSPhoneInput } from "./phone-input";

afterEach(cleanup);

const COUNTRIES = [
  { id: "sa", code: "SA", name: "Saudi Arabia" },
  { id: "eg", code: "EG", name: "Egypt" },
  { id: "ae", code: "AE", name: "United Arab Emirates" },
];

function Owned({ initial, proposed }: { initial: string; proposed: string | null }) {
  const [value, setValue] = useState(initial);
  const [country, setCountry] = useState(proposed);
  return (
    <>
      <OMSPhoneInput
        value={value}
        onChange={setValue}
        countries={COUNTRIES}
        proposedCountryCode={country}
        id="phone"
      />
      <output data-testid="value">{value}</output>
      <button type="button" onClick={() => setCountry("SA")}>
        address-sa
      </button>
    </>
  );
}

const picker = () => screen.getByTestId("calling-code-picker");

describe("OMSPhoneInput — field-owned calling code (R13 A1)", () => {
  it("re-opens a +966 phone as +966 although the address country is Egypt", () => {
    render(<Owned initial="+966501234567" proposed="EG" />);
    expect(picker().textContent).toContain("+966");
  });

  it("follows the address proposal while empty, keeps the code once a number is entered", () => {
    render(<Owned initial="" proposed="EG" />);
    expect(picker().textContent).toContain("+20");
    const input = document.getElementById("phone") as HTMLInputElement;
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: "1001234567" } });
    fireEvent.blur(input);
    expect(screen.getByTestId("value").textContent).toBe("+201001234567");
    fireEvent.click(screen.getByText("address-sa"));
    expect(picker().textContent).toContain("+20");
    expect(screen.getByTestId("value").textContent).toBe("+201001234567");
  });
});
