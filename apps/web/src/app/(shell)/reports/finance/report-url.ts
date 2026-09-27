import {
  EMPTY_REPORT_FILTERS,
  type ReportFilterValue,
} from "@/components/accounting/report-filter-bar";
import { fromISODate, toISODate } from "@/lib/date";

/**
 * Report filters in the URL — so a reload, Back from a drill-down or a
 * shared link reopens exactly the same scope, and a drill-down carries the
 * period and dimensions into the target report.
 */
const PARAM = {
  from: "from",
  to: "to",
  company: "company",
  branch: "branch",
  costCenter: "costCenter",
  project: "project",
  currency: "currency",
  posted: "posted",
} as const;

export const REPORT_FILTER_PARAMS: readonly string[] = Object.values(PARAM);

type ParamReader = { get(name: string): string | null };

export function filtersFromSearchParams(params: ParamReader): ReportFilterValue {
  return {
    companyId: params.get(PARAM.company) ?? "",
    branchId: params.get(PARAM.branch) ?? "",
    costCenterId: params.get(PARAM.costCenter) ?? "",
    projectId: params.get(PARAM.project) ?? "",
    currencyId: params.get(PARAM.currency) ?? "",
    dateRange: {
      from: fromISODate(params.get(PARAM.from)),
      to: fromISODate(params.get(PARAM.to)),
    },
    postedOnly: params.get(PARAM.posted) !== "0",
  };
}

/** Writes the filters into `base` (other params kept); defaults are omitted. */
export function writeFiltersToSearchParams(
  filters: ReportFilterValue,
  base: URLSearchParams = new URLSearchParams(),
): URLSearchParams {
  const next = new URLSearchParams(base.toString());
  const set = (key: string, value: string | null | undefined) => {
    if (value) next.set(key, value);
    else next.delete(key);
  };
  set(PARAM.from, filters.dateRange.from ? toISODate(filters.dateRange.from) : null);
  set(PARAM.to, filters.dateRange.to ? toISODate(filters.dateRange.to) : null);
  set(PARAM.company, filters.companyId);
  set(PARAM.branch, filters.branchId);
  set(PARAM.costCenter, filters.costCenterId);
  set(PARAM.project, filters.projectId);
  set(PARAM.currency, filters.currencyId);
  set(PARAM.posted, filters.postedOnly === EMPTY_REPORT_FILTERS.postedOnly ? null : "0");
  return next;
}

/** Same-scope drill-down: an account's statement for the report's period and dimensions. */
export function accountStatementHref(accountId: string, filters: ReportFilterValue): string {
  const params = writeFiltersToSearchParams(filters);
  params.set("report", "accountStatement");
  params.set("account", accountId);
  return `/reports/finance?${params.toString()}`;
}

/** Same-scope drill-down: a customer's / supplier's statement. */
export function partnerStatementHref(
  partnerId: string,
  role: "CUSTOMER" | "SUPPLIER",
  filters: ReportFilterValue,
): string {
  const params = writeFiltersToSearchParams(filters);
  params.set("report", role === "CUSTOMER" ? "customerStatement" : "supplierStatement");
  params.set("partner", partnerId);
  return `/reports/finance?${params.toString()}`;
}
