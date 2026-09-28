"use client";

import { formatAmountParts, type NegativeStyle } from "@/lib/money";
import { useLocale } from "@/providers/locale-provider";
import { useUiPilot } from "@/providers/ui-pilot-provider";
import { clsx as cx } from "clsx";
import { useDrCrLabels } from "./use-report-format";

/**
 * The one money cell for financial reports, built on `formatAmountParts` —
 * the same text the summary, Excel, CSV and print produce.
 *
 * - Weight comes from the row kind (inherited), never from the cell.
 * - Zero is a quiet "—"; a missing value (not applicable) is blank.
 * - A negative always carries its sign in text (minus, parentheses or a
 *   Cr side). Color is reserved for genuinely adverse figures (`adverse`,
 *   e.g. a net loss) — a normal credit balance is never red.
 * - The block owns end alignment in the page direction (so it shares the
 *   header's end edge in RTL and LTR); only the digits run is `num`
 *   (tabular, isolated LTR). The Dr/Cr side sits in a fixed-width slot so
 *   figures stay aligned down the column.
 */
export function ReportMoney({
  value,
  negative = "minus",
  quiet,
  adverse,
}: {
  value: number | undefined;
  negative?: NegativeStyle;
  /** De-emphasized (e.g. an expanded parent whose children show the detail). */
  quiet?: boolean;
  /** A genuinely adverse figure (net loss, discrepancy). */
  adverse?: boolean;
}) {
  const drcrLabels = useDrCrLabels();
  // Pilot: the AA-safe red for text (solid --destructive is 4.0:1 on dark).
  const adverseClass = useUiPilot().active
    ? "text-destructive-soft-foreground"
    : "text-destructive";
  const parts =
    value === undefined ? null : formatAmountParts(value, { negative, zero: "dash", drcrLabels });
  return (
    <span
      className={cx(
        "block w-full text-end whitespace-nowrap",
        quiet && "text-muted-foreground",
        adverse && adverseClass,
        parts?.isZero && "font-normal text-muted-foreground",
      )}
    >
      {parts ? <span className="num">{parts.figure}</span> : null}
      {negative === "drcr" ? <DrCrSlot side={parts?.side ?? ""} /> : null}
    </span>
  );
}

/** Fixed-width Dr/Cr slot at the logical end of a balance cell. */
function DrCrSlot({ side }: { side: string }) {
  const { locale } = useLocale();
  return (
    <span
      className={cx(
        "ms-1 inline-block text-start text-caption font-normal text-muted-foreground",
        locale === "ar" ? "w-8" : "w-5",
      )}
    >
      {side}
    </span>
  );
}
