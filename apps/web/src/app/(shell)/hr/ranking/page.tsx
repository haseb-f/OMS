"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { PageWorkspace } from "@/components/shared/page-workspace";
import { EnterpriseDataTable } from "@/components/master-data/enterprise-data-table";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { salesTargetsService, type TargetMetric } from "@/services/sales-targets-service";
import { buildRankingColumns } from "@/config/hr/ranking";
import { useLocale } from "@/providers/locale-provider";
import { toast } from "@/lib/toast";
import { ApiError } from "@/services/api-client";

const METRICS: TargetMetric[] = ["COLLECTED_SALES", "SALES_REVENUE", "ORDERS_COUNT"];

function currentPeriod(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
}

export default function RankingPage() {
  const { t } = useLocale();
  const [period, setPeriod] = useState(currentPeriod());
  const [metric, setMetric] = useState<TargetMetric>("COLLECTED_SALES");
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
    void load();
  }, [load]);

  const columns = useMemo(() => buildRankingColumns(t, total), [t, total]);

  return (
    <PageWorkspace title={t("hr.ranking.title")} description={t("hr.ranking.description")}>
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
            <Input
              type="month"
              value={period}
              onChange={(event) => setPeriod(event.target.value)}
              className="h-(--control-height-sm) w-40"
              aria-label={t("hr.salesTargets.fields.period")}
            />
            <Select value={metric} onValueChange={(value) => setMetric(value as TargetMetric)}>
              <SelectTrigger size="sm" className="w-48">
                <SelectValue placeholder={t("hr.salesTargets.fields.metric")} />
              </SelectTrigger>
              <SelectContent>
                {METRICS.map((value) => (
                  <SelectItem key={value} value={value}>
                    {t(`hr.salesTargets.metric.${value}`)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </>
        }
      />
    </PageWorkspace>
  );
}
