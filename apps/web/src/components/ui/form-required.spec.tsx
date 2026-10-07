import { afterEach, describe, expect, it } from "vitest";
import { act, cleanup, render, screen } from "@testing-library/react";
import { useForm } from "react-hook-form";
import { LocaleProvider } from "@/providers/locale-provider";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  RequiredFieldsLegend,
} from "@/components/ui/form";
import { TextFormField } from "@/components/shared/form-fields";

/** R14 W1 (spec-1 §4) — required fields: visible destructive asterisk + aria-required. */
function Harness({ required }: { required: boolean }) {
  const form = useForm<{ name: string; note: string }>({
    defaultValues: { name: "", note: "" },
  });
  return (
    <LocaleProvider>
      <Form {...form}>
        <form className="group/required-scope">
          <TextFormField control={form.control} name="name" label="Name" required={required} />
          <FormField
            control={form.control}
            name="note"
            render={({ field }) => (
              <FormItem>
                <FormLabel required>Note</FormLabel>
                <FormControl>
                  <input {...field} />
                </FormControl>
              </FormItem>
            )}
          />
          <RequiredFieldsLegend />
        </form>
      </Form>
    </LocaleProvider>
  );
}

describe("required fields", () => {
  afterEach(() => {
    cleanup();
    window.localStorage.clear();
  });

  it("shows a destructive (not muted) asterisk hidden from assistive tech", () => {
    render(<Harness required />);
    const label = screen.getByText("Name").closest("[data-slot=form-label]")!;
    const mark = label.querySelector("[data-slot=required-mark]")!;
    expect(mark.textContent).toBe("*");
    expect(mark.getAttribute("aria-hidden")).toBe("true");
    expect(mark.className).toContain("text-destructive");
    expect(mark.className).not.toContain("text-muted-foreground");
  });

  it("puts aria-required on the control through the shared wrapper and a bare FormLabel", () => {
    render(<Harness required />);
    expect(screen.getByRole("textbox", { name: /Name/ }).getAttribute("aria-required")).toBe(
      "true",
    );
    expect(screen.getByRole("textbox", { name: /Note/ }).getAttribute("aria-required")).toBe(
      "true",
    );
  });

  it("follows a conditional requirement computed from watched values", () => {
    const { rerender } = render(<Harness required={false} />);
    const name = () => screen.getByRole("textbox", { name: /Name/ });
    expect(name().hasAttribute("aria-required")).toBe(false);
    expect(
      screen.getByText("Name").closest("label")!.querySelector("[data-slot=required-mark]"),
    ).toBeNull();
    act(() => rerender(<Harness required />));
    expect(name().getAttribute("aria-required")).toBe("true");
  });

  it("renders the '* Required field' legend, shown only when the scope has a required mark", () => {
    render(<Harness required />);
    const legend = document.querySelector("[data-slot=required-legend]")!;
    expect(legend.textContent).toContain("*");
    expect(legend.className).toContain("hidden");
    expect(legend.className).toContain("group-has-[[data-slot=required-mark]]/required-scope:flex");
  });
});
