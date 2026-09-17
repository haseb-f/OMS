"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { PageWorkspace } from "@/components/shared/page-workspace";
import { EnterpriseDataTable } from "@/components/master-data/enterprise-data-table";
import { EnterpriseMonthPicker } from "@/components/shared/month-picker";
import { SelectFilter } from "@/components/shared/data-table/select-filter";
import { ClearFiltersButton } from "@/components/shared/data-table/clear-filters-button";
import { salesTargetsService, type TargetMetric } from "@/services/sales-targets-service";
import { buildRankingColumns } from "@/config/hr/ranking";
import { useLocale } from "@/providers/locale-provider";
import { toast } from "@/lib/toast";
import { currentMonthValue } from "@/lib/date";
import { ApiError } from "@/services/api-client";

const METRICS: TargetMetric[] = ["COLLECTED_SALES", "SALES_REVENUE", "ORDERS_COUNT"];
/**
 * A leaderboard is always ranked by exactly one metric over exactly one
 * period — `GET /sales-targets/ranking` has no "all metrics" mode and falls
 * back to this same metric server-side. So neither filter can be emptied:
 * clearing them means restoring these defaults.
 */
const DEFAULT_METRIC: TargetMetric = "COLLECTED_SALES";

export default function RankingPage() {
  const { t } = useLocale();
  const [defaultPeriod] = useState(currentMonthValue);
  const [period, setPeriod] = useState(defaultPeriod);
  const [metric, setMetric] = useState<TargetMetric>(DEFAULT_METRIC);
  const [total, setTotal] = useState(0);
  const [leaderboard, setLeaderboard] = useState<
    Awaited<ReturnType<typeof salesTargetsService.ranking>>["leaderboard"]
  >([]);
  const [isLoading, setIsLoading] = useState(true);

  const load = useCallback(async () => {
    setIsLoading(true);
    try {
      const result = await salesTargetsService.ranking({ period, metric });
      setLeaderboard(result.leaderboard);
      setTotal(result.total);
    } catch (error) {
      toast.error(error instanceof ApiError ? error.message : t("common.failedToSave"));
    } finally {
      setIsLoading(false);
    }
  }, [period, metric, t]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  const columns = useMemo(() => buildRankingColumns(t, total), [t, total]);

  const activeFilterCount = metric === DEFAULT_METRIC ? 0 : 1;

  return (
    <PageWorkspace title={t("hr.ranking.title")} description={t("hr.ranking.description")} dense>
      <EnterpriseDataTable
        tableId="hr-ranking"
        printTitle={t("hr.ranking.title")}
        columns={columns}
        data={leaderboard}
        isLoading={isLoading}
        onRefresh={load}
        getRowId={(row) => row.employeeProfileId}
        emptyTitle={t("hr.ranking.noData")}
        filterBar={
          <>
            <EnterpriseMonthPicker
              value={period}
              onChange={setPeriod}
              aria-label={t("hr.salesTargets.fields.period")}
            />
            <SelectFilter
              label={t("hr.salesTargets.fields.metric")}
              value={metric}
              onChange={(value) => setMetric((value || DEFAULT_METRIC) as TargetMetric)}
              options={METRICS.map((value) => ({
                value,
                label: t(`hr.salesTargets.metric.${value}`),
              }))}
            />
            <ClearFiltersButton
              activeCount={activeFilterCount}
              onClear={() => {
                setPeriod(defaultPeriod);
                setMetric(DEFAULT_METRIC);
              }}
            />
          </>
        }
      />
    </PageWorkspace>
  );
}
