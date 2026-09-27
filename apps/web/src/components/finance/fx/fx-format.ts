import { formatDate, fromISODate } from "@/lib/date";
import type { MessageKey } from "@/i18n/translate";
import type { FxSyncRunStatus } from "@/services/fx-service";
import type { StatusTone } from "@/components/business/status-badge";

type Translate = (key: MessageKey, params?: Record<string, string | number>) => string;

const KNOWN_SOURCES = ["CBE", "MANUAL", "IMPORT", "OVERRIDE", "IDENTITY"] as const;

/** Provenance label for an ExchangeRate.source / resolution source. */
export function fxSourceLabel(t: Translate, source: string | null | undefined): string {
  if (!source) return "—";
  return (KNOWN_SOURCES as readonly string[]).includes(source)
    ? t(`fxSettings.sources.${source}` as MessageKey)
    : t("fxSettings.sources.other", { source });
}

/** Short weekday name of a 'YYYY-MM-DD' (or ISO) business date. */
export function fxWeekday(t: Translate, value: string | null | undefined): string {
  const date = fromISODate(value?.slice(0, 10));
  return date ? t(`fxSettings.weekdays.${date.getDay()}` as MessageKey) : "";
}

/** "Thu 24 Sep 2026". */
export function fxDayLabel(t: Translate, value: string | null | undefined): string {
  if (!value) return "—";
  return `${fxWeekday(t, value)} ${formatDate(value.slice(0, 10))}`.trim();
}

/** Rates are exact decimals (up to 8 dp); show them without float noise. */
export function formatFxRate(value: string | number | null | undefined): string {
  if (value === null || value === undefined || value === "") return "—";
  const n = Number(value);
  return Number.isFinite(n) ? String(Math.round(n * 1e8) / 1e8) : "—";
}

export const FX_RUN_TONE: Record<FxSyncRunStatus, StatusTone> = {
  RUNNING: "info",
  SUCCESS: "success",
  PARTIAL: "warning",
  FAILED: "destructive",
  SKIPPED: "neutral",
};
