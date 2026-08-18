"use client";

import { useEffect, useState } from "react";
import { CalendarIcon } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { EnterpriseButton } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useLocale } from "@/providers/locale-provider";
import { cn } from "@/lib/utils";
import {
  DATE_RANGE_PRESETS,
  formatDate,
  formatDateRange,
  getPresetRange,
  type DateRangePreset,
} from "@/lib/date";
import type { MessageKey } from "@/i18n/translate";

export interface DateRangeValue {
  from: Date | null;
  to: Date | null;
}

/** No preset selected yet — kept out of `DATE_RANGE_PRESETS` so `SelectValue` falls back to its placeholder, same sentinel pattern every other OMS `Select` uses (never a literal `undefined` controlled value). */
const NO_PRESET = "__none__";

/** Same border radius/typography as every other OMS field — reused for both From and To. */
function DateField({ labelKey, date }: { labelKey: MessageKey; date: Date | null }) {
  const { t } = useLocale();
  return (
    <div className="grid grid-cols-[2.25rem_1fr] items-center gap-x-1.5">
      <span className="text-caption text-muted-foreground">{t(labelKey)}</span>
      <div className="flex h-7 items-center gap-1 rounded-xs border border-input bg-input/30 px-2">
        <CalendarIcon className="size-3 shrink-0 text-muted-foreground" />
        <span dir="ltr" className={cn("truncate text-caption", !date && "text-muted-foreground")}>
          {date ? formatDate(date) : "—"}
        </span>
      </div>
    </div>
  );
}

/** Sorts two days into ascending [from, to] order — pure UI display ordering, not a filtering/business date calculation. */
function sortDays(a: Date, b: Date): [Date, Date] {
  return a.getTime() <= b.getTime() ? [a, b] : [b, a];
}

/**
 * The ONE report date-range filter every module reuses (OMS Design System
 * Unification task). Layout is fixed, top to bottom: Quick Range, From, To,
 * Calendar, Footer — nothing else. The calendar is the shared `Calendar`
 * primitive used everywhere else in OMS, rendered with its own compact
 * built-in header (one centered month label, one previous button, one next
 * button) — never a second, hand-built set of navigation controls layered
 * on top of it.
 *
 * Manual selection is a deliberate 2-click state machine (not
 * `react-day-picker`'s built-in range mode): the first click always starts
 * a *new* selection and keeps the popup open, hovering afterward previews
 * the range live, and the second click (in either date order) completes
 * the range. Quick Range selection likewise only stages a selection.
 * Nothing reaches the caller until "Apply" is clicked; "Cancel" and Esc
 * both discard whatever was staged and close, same as never having opened
 * the popup.
 */
export function EnterpriseDateRangePicker({
  value,
  onChange,
  className,
}: {
  value: DateRangeValue;
  onChange: (range: DateRangeValue) => void;
  className?: string;
}) {
  const { t, direction } = useLocale();
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState<DateRangeValue>(value);
  const [selectedPreset, setSelectedPreset] = useState<DateRangePreset | null>(null);
  const [clickStart, setClickStart] = useState<Date | null>(null);
  const [hoverDate, setHoverDate] = useState<Date | null>(null);
  const [viewMonth, setViewMonth] = useState<Date>(value.from ?? new Date());

  useEffect(() => {
    if (!open) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setPending(value);
    setSelectedPreset(null);
    setClickStart(null);
    setHoverDate(null);
    setViewMonth(value.from ?? new Date());
  }, [open, value]);

  const applyPreset = (preset: DateRangePreset) => {
    const range = getPresetRange(preset);
    setPending(range);
    setSelectedPreset(preset);
    setClickStart(null);
    setHoverDate(null);
    setViewMonth(range.from);
  };

  const handleDayClick = (day: Date) => {
    setSelectedPreset(null);
    if (!clickStart) {
      // First click of a new selection — always starts fresh, never auto-completes a stale pending range.
      setClickStart(day);
      setHoverDate(null);
      setPending({ from: day, to: null });
      return;
    }
    // Second click — completes the range in either click order, but only stages it; Apply commits it.
    const [from, to] = sortDays(clickStart, day);
    setPending({ from, to });
    setClickStart(null);
    setHoverDate(null);
  };

  const handleDayHover = (day: Date) => {
    if (!clickStart) return;
    setHoverDate(day);
  };

  const handleApply = () => {
    onChange(pending);
    setOpen(false);
  };

  const label = formatDateRange(value.from, value.to);

  const previewFrom = clickStart ?? pending.from ?? null;
  const previewTo = clickStart ? (hoverDate ?? clickStart) : (pending.to ?? null);
  const [rangeFrom, rangeTo] =
    previewFrom && previewTo ? sortDays(previewFrom, previewTo) : [previewFrom, previewFrom];

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <EnterpriseButton
          type="button"
          variant="outline"
          size="sm"
          className={cn("justify-start font-normal", className)}
        >
          <CalendarIcon className="size-4 text-muted-foreground" />
          <span dir="ltr">{label || t("datePicker.selectRange")}</span>
        </EnterpriseButton>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        dir={direction}
        className="flex w-[260px] flex-col gap-2 rounded-xs border border-border bg-card p-2 shadow-md"
      >
        <Select
          value={selectedPreset ?? NO_PRESET}
          onValueChange={(preset) => {
            if (preset !== NO_PRESET) applyPreset(preset as DateRangePreset);
          }}
        >
          <SelectTrigger size="sm" className="w-full">
            <SelectValue placeholder={t("datePicker.quickRange")} />
          </SelectTrigger>
          <SelectContent>
            {DATE_RANGE_PRESETS.map((preset) => (
              <SelectItem key={preset} value={preset}>
                {t(`datePicker.presets.${preset}` as MessageKey)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <div className="flex flex-col gap-1">
          <DateField labelKey="datePicker.from" date={pending.from} />
          <DateField labelKey="datePicker.to" date={pending.to} />
        </div>

        <Calendar
          mode="single"
          dir={direction}
          selected={undefined}
          month={viewMonth}
          onMonthChange={setViewMonth}
          onDayClick={(day) => handleDayClick(day)}
          onDayMouseEnter={(day) => handleDayHover(day)}
          numberOfMonths={1}
          className="p-0"
          classNames={{
            range_start:
              "[&>button]:bg-primary [&>button]:text-primary-foreground [&>button]:rounded-s-xs [&>button]:rounded-e-none",
            range_end:
              "[&>button]:bg-primary [&>button]:text-primary-foreground [&>button]:rounded-e-xs [&>button]:rounded-s-none",
            range_middle:
              "bg-primary/10 [&>button]:rounded-none [&>button]:bg-transparent [&>button]:text-foreground",
          }}
          modifiers={{
            range_start: rangeFrom ? [rangeFrom] : [],
            range_end: rangeTo ? [rangeTo] : [],
            range_middle: rangeFrom && rangeTo ? { after: rangeFrom, before: rangeTo } : [],
          }}
        />

        <div className="flex items-center justify-end gap-1">
          <EnterpriseButton type="button" variant="ghost" size="sm" onClick={() => setOpen(false)}>
            {t("datePicker.cancel")}
          </EnterpriseButton>
          <EnterpriseButton type="button" size="sm" disabled={!!clickStart} onClick={handleApply}>
            {t("datePicker.apply")}
          </EnterpriseButton>
        </div>
      </PopoverContent>
    </Popover>
  );
}
