"use client";

import { useEffect, useState } from "react";
import { CalendarIcon } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { EnterpriseButton } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Calendar } from "@/components/ui/calendar";
import { useLocale } from "@/providers/locale-provider";
import { cn } from "@/lib/utils";
import { formatDate, parseDate } from "@/lib/date";

/**
 * The ONE Date Picker every module in OMS uses (Date System task) — never
 * the browser's native `<input type="date">`, never a page-local picker.
 * Supports both selecting from the calendar and manual typing in the fixed
 * "DD-MMM-YYYY" display format, with inline validation for anything else.
 *
 * A single click on a day commits immediately and closes the popover
 * (minimum clicks) — Today/Clear do the same. Apply is reserved for
 * `EnterpriseDateRangePicker`, where a range genuinely has an in-progress state to
 * confirm; a single date never does.
 */
export function EnterpriseDatePicker({
  value,
  onChange,
  placeholder = "DD-MMM-YYYY",
  disabled,
  className,
  id,
  "aria-invalid": ariaInvalid,
}: {
  value: Date | null | undefined;
  onChange: (date: Date | null) => void;
  placeholder?: string;
  disabled?: boolean;
  className?: string;
  id?: string;
  "aria-invalid"?: boolean;
}) {
  const { t, direction } = useLocale();
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(() => formatDate(value));
  const [error, setError] = useState(false);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setDraft(formatDate(value));
    setError(false);
  }, [value]);

  const commitDraft = (raw: string) => {
    if (raw.trim() === "") {
      setError(false);
      onChange(null);
      return;
    }
    const parsed = parseDate(raw);
    if (parsed) {
      setError(false);
      setDraft(formatDate(parsed));
      onChange(parsed);
    } else {
      setError(true);
    }
  };

  const selectDay = (date: Date | undefined) => {
    if (!date) return;
    setDraft(formatDate(date));
    setError(false);
    onChange(date);
    setOpen(false);
  };

  return (
    <div className={cn("flex flex-col gap-1.5", className ?? "w-(--width-control-date)")}>
      {/*
        `dir="ltr"` here (not just on the `Input`) is the actual fix: the
        displayed value is always fixed-format "DD-MMM-YYYY" (never
        bidi-reordered), so the trigger icon must be positioned in that same
        LTR coordinate space. Without this wrapper, `pe-8` below resolves
        against the Input's own forced-ltr direction (physical end = right)
        while the icon button's `end-*` logical inset resolves against the
        *ambient* page direction — physical end = left in RTL. That mismatch
        is what let the icon collide with the date text in Arabic. Anchoring
        both to one local `dir="ltr"` makes every logical property in this
        subtree agree, in both locales, with zero page-level changes.
      */}
      <div className="relative" dir="ltr">
        <Input
          id={id}
          dir="ltr"
          value={draft}
          placeholder={placeholder}
          disabled={disabled}
          aria-invalid={ariaInvalid || error}
          className="pe-8"
          onChange={(event) => {
            setDraft(event.target.value);
            if (error) setError(false);
          }}
          onBlur={(event) => commitDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              commitDraft(draft);
            }
          }}
        />
        <Popover open={open} onOpenChange={setOpen}>
          <PopoverTrigger asChild>
            <EnterpriseButton
              type="button"
              variant="ghost"
              size="icon-xs"
              disabled={disabled}
              className="absolute inset-y-0 end-1 my-auto"
              aria-label={t("datePicker.open")}
            >
              <CalendarIcon className="size-3.5 text-muted-foreground" />
            </EnterpriseButton>
          </PopoverTrigger>
          <PopoverContent
            align="start"
            dir={direction}
            className="w-auto rounded-xs border border-border bg-card p-0 shadow-md"
          >
            <Calendar
              mode="single"
              dir={direction}
              selected={value ?? undefined}
              onSelect={selectDay}
              autoFocus
            />
            <div className="flex items-center justify-between gap-2 border-t border-border p-2.5">
              <EnterpriseButton
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => selectDay(new Date())}
              >
                {t("datePicker.today")}
              </EnterpriseButton>
              <EnterpriseButton
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => {
                  setDraft("");
                  setError(false);
                  onChange(null);
                  setOpen(false);
                }}
              >
                {t("datePicker.clear")}
              </EnterpriseButton>
            </div>
          </PopoverContent>
        </Popover>
      </div>
      {error && <p className="text-caption text-destructive">{t("datePicker.invalid")}</p>}
    </div>
  );
}
