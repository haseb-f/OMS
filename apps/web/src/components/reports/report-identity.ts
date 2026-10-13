import {
  CalendarCheck,
  CalendarClock,
  CalendarDays,
  CalendarMinus,
  CalendarRange,
  type LucideIcon,
} from "lucide-react";
import type { InsightIconMotion, InsightIdentity } from "@/components/shared/insight-card";
import type { LivePeriod } from "@/services/sales-reports-service";

/**
 * R19 §C2 — the ONE colour-identity mapping of the sales-report cards (company `/reports/sales`
 * and agent `/agent/reports`). An identity follows the METRIC / PERIOD a card shows, never its
 * position or its value, so the same metric has the same colour on every tab, screen and role,
 * and every card of a fixed summary group reads apart. Hues are tokens (`--report-identity-*`,
 * theme/tokens.css); green / amber / red are never identities — they stay the semantic text
 * colours (success / attention / danger) inside a card. Documented in
 * specs/round19-improvements/progress-c.md (C2).
 */
export interface ReportIdentity {
  hue: InsightIdentity;
  /** The icon's short hover / focus motion, suited to the icon. */
  motion: InsightIconMotion;
}

/** Live periods — near → far runs teal → sky → blue → violet → orchid (calendar icons lift). */
export const PERIOD_IDENTITY: Record<LivePeriod, ReportIdentity> = {
  today: { hue: "teal", motion: "lift" },
  yesterday: { hue: "sky", motion: "lift" },
  last7Days: { hue: "blue", motion: "lift" },
  thisMonth: { hue: "violet", motion: "lift" },
  lastMonth: { hue: "orchid", motion: "lift" },
};

/** The icon of each Live period (Live cards and the employee period boxes share it). */
export const PERIOD_ICON: Record<LivePeriod, LucideIcon> = {
  today: CalendarCheck,
  yesterday: CalendarMinus,
  last7Days: CalendarRange,
  thisMonth: CalendarDays,
  lastMonth: CalendarClock,
};

/**
 * Performance metrics. A person's valid orders are ONE metric (an employee card and "Your
 * sales" share blue); teams, the own rank and the separate rows each have their own hue. Lists
 * (one card per employee / per team) share their metric's hue — the name and the rank badge
 * tell the cards apart, a rainbow of people would carry no meaning.
 */
export const METRIC_IDENTITY = {
  personSales: { hue: "blue", motion: "scale" },
  teamSales: { hue: "violet", motion: "scale" },
  ownRank: { hue: "indigo", motion: "lift" },
  agentSales: { hue: "teal", motion: "tilt" },
  unassigned: { hue: "slate", motion: "scale" },
} as const satisfies Record<string, ReportIdentity>;

/**
 * Payment mix — one card per order currency. Common currencies are pinned; any other code
 * takes a stable hue from its letters (the same code always gets the same colour).
 */
const CURRENCY_HUES: Record<string, InsightIdentity> = {
  EGP: "teal",
  SAR: "sky",
  USD: "blue",
  AED: "indigo",
  EUR: "violet",
  KWD: "orchid",
};
const CURRENCY_FALLBACK: InsightIdentity[] = ["sky", "violet", "teal", "orchid", "blue", "indigo"];

export function currencyIdentity(code: string): ReportIdentity {
  const pinned = CURRENCY_HUES[code.toUpperCase()];
  if (pinned) return { hue: pinned, motion: "tilt" };
  let hash = 0;
  for (const char of code.toUpperCase()) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  return { hue: CURRENCY_FALLBACK[hash % CURRENCY_FALLBACK.length], motion: "tilt" };
}
