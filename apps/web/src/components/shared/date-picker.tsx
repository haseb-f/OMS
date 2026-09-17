"use client";

import { useEffect, useState } from "react";
import { CalendarIcon, X } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { EnterpriseButton } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupInput,
} from "@/components/ui/input-group";
import { Label } from "@/components/ui/label";
import { Calendar } from "@/components/ui/calendar";
import { useLocale } from "@/providers/locale-provider";
import { cn } from "@/lib/utils";
import { formatDate, formatDateTime, formatTime, parseDate } from "@/lib/date";

/**
 * The ONE Date Picker every module in OMS uses — never the browser's native
 * `<input type="date">`, never a page-local picker. Magnifier-equivalent
 * calendar icon, typed value and clear X share one border (same contract as
 * `SearchInput`). Typing uses the fixed "DD MMM YYYY" display format.
 *
 * A single click on a day commits immediately and closes the popover
 * (minimum clicks) — Today/Clear do the same. Apply is reserved for
 * `EnterpriseDateRangePicker`.
 */
export function EnterpriseDatePicker({
  value,
  onChange,
  placeholder = "DD MMM YYYY",
  disabled,
  className,
  id,
  "aria-invalid": ariaInvalid,
  showTime = false,
}: {
  value: Date | null | undefined;
  onChange: (date: Date | null) => void;
  placeholder?: string;
  disabled?: boolean;
  className?: string;
  id?: string;
  "aria-invalid"?: boolean;
  /**
   * Adds a 24h time-of-day field inside the popover (never a native
   * `<input type="datetime-local">`) for the rare form field that needs a
   * scheduled moment, not just a calendar day — e.g. a Lead follow-up.
   */
  showTime?: boolean;
}) {
  const { t, direction } = useLocale();
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(() => (showTime ? formatDateTime(value) : formatDate(value)));
  const [error, setError] = useState(false);
  const [timeValue, setTimeValue] = useState(() => formatTime(value) || "09:00");

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setDraft(showTime ? formatDateTime(value) : formatDate(value));
    setError(false);
    if (formatTime(value)) {
      setTimeValue(formatTime(value));
    }
  }, [value, showTime]);

  const combineWithTime = (day: Date, time: string) => {
    const [hours, minutes] = time.split(":").map(Number);
    const combined = new Date(day);
    combined.setHours(hours || 0, minutes || 0, 0, 0);
    return combined;
  };

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
    const result = showTime ? combineWithTime(date, timeValue) : date;
    setDraft(showTime ? formatDateTime(result) : formatDate(result));
    setError(false);
    onChange(result);
    if (!showTime) setOpen(false);
  };

  const changeTime = (time: string) => {
    setTimeValue(time);
    const day = value ?? new Date();
    const combined = combineWithTime(day, time);
    setDraft(formatDateTime(combined));
    onChange(combined);
  };

  const clear = () => {
    setDraft("");
    setError(false);
    onChange(null);
    setOpen(false);
  };

  const calendar = (
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
      {showTime ? (
        <div className="flex items-center gap-2 border-t border-border p-2.5" dir="ltr">
          <Label
            htmlFor={id ? `${id}-time` : undefined}
            className="text-caption text-muted-foreground"
          >
            {t("datePicker.time")}
          </Label>
          <Input
            id={id ? `${id}-time` : undefined}
            type="time"
            dir="ltr"
            value={timeValue}
            className="h-8 w-auto"
            onChange={(event) => changeTime(event.target.value)}
          />
        </div>
      ) : null}
      <div className="flex items-center justify-between gap-2 border-t border-border p-2.5">
        <EnterpriseButton
          type="button"
          variant="ghost"
          size="sm"
          onClick={() => selectDay(new Date())}
        >
          {t("datePicker.today")}
        </EnterpriseButton>
        <EnterpriseButton type="button" variant="ghost" size="sm" onClick={clear}>
          {t("datePicker.clear")}
        </EnterpriseButton>
      </div>
    </PopoverContent>
  );

  return (
    <div className={cn("flex flex-col gap-1.5", className ?? "w-(--width-control-date)")}>
      {/*
        `dir="ltr"` on the group keeps "DD MMM YYYY" and the calendar/clear
        addons in one coordinate space so RTL layout cannot collide the icon
        with the typed date.
      */}
      <Popover open={open} onOpenChange={setOpen}>
        <InputGroup dir="ltr" className="h-(--control-height-sm)" data-slot="date-picker">
          <InputGroupInput
            id={id}
            dir="ltr"
            value={draft}
            placeholder={showTime ? "DD MMM YYYY — HH:mm" : placeholder}
            disabled={disabled}
            readOnly={showTime}
            aria-invalid={ariaInvalid || error}
            onChange={
              showTime
                ? undefined
                : (event) => {
                    setDraft(event.target.value);
                    if (error) setError(false);
                  }
            }
            onClick={showTime ? () => setOpen(true) : undefined}
            onBlur={showTime ? undefined : (event) => commitDraft(event.target.value)}
            onKeyDown={
              showTime
                ? undefined
                : (event) => {
                    if (event.key === "Enter") {
                      event.preventDefault();
                      commitDraft(draft);
                    }
                  }
            }
          />
          {draft && !disabled ? (
            <InputGroupAddon align="inline-end">
              <InputGroupButton
                type="button"
                size="icon-xs"
                aria-label={t("datePicker.clear")}
                onClick={clear}
              >
                <X />
              </InputGroupButton>
            </InputGroupAddon>
          ) : null}
          <InputGroupAddon align="inline-end">
            <PopoverTrigger asChild>
              <InputGroupButton
                type="button"
                size="icon-xs"
                disabled={disabled}
                aria-label={t("datePicker.open")}
                aria-expanded={open}
              >
                <CalendarIcon />
              </InputGroupButton>
            </PopoverTrigger>
          </InputGroupAddon>
        </InputGroup>
        {calendar}
      </Popover>
      {error && <p className="text-caption text-destructive">{t("datePicker.invalid")}</p>}
    </div>
  );
}
