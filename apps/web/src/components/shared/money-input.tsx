"use client";

import * as React from "react";
import { Input } from "@/components/ui/input";
import { useLocale } from "@/providers/locale-provider";
import { cn } from "@/lib/utils";
import { normalizeNumericText, parseNumericText, sanitizeNumericText } from "@/lib/numeric-input";

/**
 * Physical alignment for a numeric field whose own direction is forced LTR.
 * `text-end` inside a `dir="ltr"` field always resolves to the right edge,
 * which breaks the shared numeric edge in Arabic (the logical end is the
 * LEFT edge there). Numeric grid inputs use this so digits, headers and
 * read-only values line up on the page's logical end in both directions.
 */
export function numericEndAlignClass(direction: "ltr" | "rtl"): string {
  return direction === "rtl" ? "text-left" : "text-right";
}

type BaseInputProps = Omit<
  React.ComponentProps<typeof Input>,
  "type" | "dir" | "value" | "defaultValue" | "onChange"
>;

export interface MoneyInputProps extends BaseInputProps {
  /** A number, a numeric string, or "" / null for an unset amount (never shown as 0). */
  value?: string | number | null;
  /**
   * Legacy change handler: `event.target.value` is the CANONICAL text
   * ("1,234.50" typed → "1234.50", Arabic-Indic digits → Latin) and
   * `event.target.valueAsNumber` its number (NaN while empty).
   */
  onChange?: (event: React.ChangeEvent<HTMLInputElement>) => void;
  /** The typed amount as a number (null while empty) plus its canonical text. */
  onValueChange?: (value: number | null, text: string) => void;
  /** Currency code (or any short unit) shown inside the field at its start edge. */
  adornment?: React.ReactNode;
  /**
   * Kept for call-site compatibility: numeric entry always aligns to the
   * logical end edge (design-system §2). Centered amounts are not allowed.
   */
  align?: "end";
}

function valueText(value: MoneyInputProps["value"]): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "number") return Number.isFinite(value) ? String(value) : "";
  return value;
}

/** Same amount for the purpose of keeping the user's own typing ("" and 0 read alike). */
function sameAmount(draft: string, value: MoneyInputProps["value"], allowNegative: boolean) {
  const typed = parseNumericText(draft, { allowNegative }) ?? 0;
  const held = parseNumericText(valueText(value), { allowNegative }) ?? 0;
  return Math.abs(typed - held) < 1e-9;
}

/** The change event with the canonical text / number on its target (prototype methods kept). */
function canonicalEvent(
  event: React.ChangeEvent<HTMLInputElement>,
  canonical: string,
): React.ChangeEvent<HTMLInputElement> {
  const input = event.target;
  const asNumber = /\d/.test(canonical) ? Number(canonical) : Number.NaN;
  const target = new Proxy(input, {
    get(element, property) {
      if (property === "value") return canonical;
      if (property === "valueAsNumber") return asNumber;
      const member = Reflect.get(element, property, element);
      return typeof member === "function" ? member.bind(element) : member;
    },
  });
  return Object.create(event, {
    target: { value: target },
    currentTarget: { value: target },
  }) as React.ChangeEvent<HTMLInputElement>;
}

/**
 * The one numeric money/amount entry control (Journal Entry debit/credit,
 * document line prices/totals, transaction amounts, ...). R22: a text field
 * with a decimal keyboard (`inputMode="decimal"`), not `type="number"` — so
 * «0.5» is never cut to «.5», a pasted «1,234.50» and Arabic-Indic digits
 * «١٢٣٤٫٥» are read, and what the person typed stays on screen while they
 * edit; on blur the field shows the canonical figure. Consumers receive the
 * canonical text (`onChange`) or the number (`onValueChange`). LTR digits,
 * tabular figures and the logical end edge in both directions.
 * `inputSize="prominent"` is the voucher amount (44px, 16px, 2px edge);
 * `adornment` shows the currency inside the field.
 */
export const MoneyInput = React.forwardRef<HTMLInputElement, MoneyInputProps>(function MoneyInput(
  {
    className,
    align,
    inputSize = "compact-md",
    min = 0,
    max,
    step,
    // Illustrative only — a placeholder is never a value and is never saved.
    placeholder = "0.00",
    value,
    onChange,
    onValueChange,
    onFocus,
    onBlur,
    adornment,
    "aria-describedby": describedBy,
    ...props
  },
  ref,
) {
  const { direction } = useLocale();
  // `align` / `max` / `step` are accepted for call-site compatibility only.
  void align;
  void max;
  void step;
  const allowNegative = min !== undefined && min !== null && Number(min) < 0;
  /** The person's own text while the field is being edited; null otherwise. */
  const [draft, setDraft] = React.useState<string | null>(null);
  const adornmentId = React.useId();

  const shown =
    draft !== null && sameAmount(draft, value, allowNegative) ? draft : valueText(value);

  const handleChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const typed = sanitizeNumericText(event.target.value, { allowNegative });
    const canonical = normalizeNumericText(typed, { allowNegative });
    setDraft(typed);
    onValueChange?.(parseNumericText(canonical, { allowNegative }), canonical);
    onChange?.(canonicalEvent(event, canonical));
  };

  const input = (
    <Input
      ref={ref}
      type="text"
      inputMode="decimal"
      autoComplete="off"
      dir="ltr"
      placeholder={placeholder}
      inputSize={inputSize}
      value={shown}
      aria-describedby={
        adornment ? [describedBy, adornmentId].filter(Boolean).join(" ") : describedBy
      }
      className={cn(
        "tabular-nums",
        numericEndAlignClass(direction),
        // Room for the currency at the start edge (the field itself is LTR).
        adornment
          ? direction === "rtl"
            ? "pe-(--money-adornment-width)"
            : "ps-(--money-adornment-width)"
          : null,
        className,
      )}
      onFocus={(event) => {
        setDraft(shown);
        onFocus?.(event);
      }}
      onBlur={(event) => {
        setDraft(null);
        onBlur?.(event);
      }}
      onChange={handleChange}
      {...props}
    />
  );

  if (!adornment) return input;
  return (
    <div className="relative min-w-0">
      {input}
      <span
        id={adornmentId}
        className="pointer-events-none absolute inset-y-0 start-0 flex w-(--money-adornment-width) items-center justify-center text-caption font-semibold text-muted-foreground"
      >
        {adornment}
      </span>
    </div>
  );
});
