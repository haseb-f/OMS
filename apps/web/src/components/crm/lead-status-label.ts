import { leadLifecycleBadge } from "@/config/crm/lead-columns";
import type { LeadRow } from "@/services/leads-service";
import type { useLocale } from "@/providers/locale-provider";

type Locale = ReturnType<typeof useLocale>;

const SYSTEM_CODES = new Set([
  "NEW",
  "IN_PROGRESS",
  "QUALIFIED",
  "CONVERTED",
  "LOST",
  "DISQUALIFIED",
]);

/**
 * `leadLifecycleBadge` with the protected system statuses
 * named in the UI language. Status names are admin data stored in Arabic, so
 * outside Arabic the known codes use the translated workflow stage names;
 * unknown (admin-added) codes keep their stored name. Arabic keeps the stored
 * names exactly as stored.
 */
export function leadStatusBadge(
  lead: Pick<LeadRow, "status" | "salesEmployeeId">,
  { t, locale }: Pick<Locale, "t" | "locale">,
) {
  const badge = leadLifecycleBadge(lead, t("crm.leads.ownership.assigned"));
  const code = lead.status?.code;
  if (locale === "ar" || !code || !SYSTEM_CODES.has(code)) return badge;
  if (code === "NEW" && lead.salesEmployeeId) return badge; // ownership label is already i18n
  return {
    ...badge,
    label: t(`workflow.funnel.stages.${code as "NEW"}`),
  };
}

/** Name of a lead status in the UI language (closed marker, notes). */
export function leadStatusName(
  status: LeadRow["status"],
  locale: Pick<Locale, "t" | "locale">,
): string | undefined {
  if (!status) return undefined;
  return leadStatusBadge({ status, salesEmployeeId: null }, locale).label;
}
