"use client";

import { useCallback, useEffect, useState } from "react";
import { PageHeader } from "@/components/shared/page-header";
import { EnterpriseButton } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useLocale } from "@/providers/locale-provider";
import { toast } from "@/lib/toast";
import { workflowService } from "@/services/workflow-service";

const FUNNEL_ORDER = [
  "NEW",
  "ASSIGNED",
  "CONTACTED",
  "FOLLOW_UP",
  "QUALIFIED",
  "CONVERTED",
  "LOST",
  "DISQUALIFIED",
] as const;

export default function LeadFunnelPage() {
  const { t } = useLocale();
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [byStatus, setByStatus] = useState<Record<string, number>>({});
  const [totalEvents, setTotalEvents] = useState(0);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const result = (await workflowService.leadFunnel({
        dateFrom: dateFrom || undefined,
        dateTo: dateTo || undefined,
      })) as { byStatus: Record<string, number>; totalEvents: number };
      setByStatus(result.byStatus ?? {});
      setTotalEvents(result.totalEvents ?? 0);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to load funnel");
    } finally {
      setLoading(false);
    }
  }, [dateFrom, dateTo]);

  useEffect(() => {
    void load();
  }, [load]);

  const max = Math.max(1, ...FUNNEL_ORDER.map((code) => byStatus[code] ?? 0));

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title={t("workflow.funnel.title")}
        subtitle={t("workflow.funnel.description")}
        actions={
          <EnterpriseButton size="sm" onClick={() => void load()} disabled={loading}>
            {t("table.refresh")}
          </EnterpriseButton>
        }
      />

      <div className="flex flex-wrap items-end gap-3">
        <div className="flex flex-col gap-1">
          <Label>{t("workflow.funnel.dateFrom")}</Label>
          <Input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} />
        </div>
        <div className="flex flex-col gap-1">
          <Label>{t("workflow.funnel.dateTo")}</Label>
          <Input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} />
        </div>
      </div>

      <p className="text-caption text-muted-foreground">
        {t("workflow.funnel.events")}: {totalEvents}
      </p>

      <div className="flex flex-col gap-2 rounded-md border border-border p-3">
        {FUNNEL_ORDER.map((code) => {
          const count = byStatus[code] ?? 0;
          const width = `${Math.round((count / max) * 100)}%`;
          return (
            <div key={code} className="flex items-center gap-3 text-caption">
              <span className="w-28 shrink-0 font-medium">{code}</span>
              <div className="h-2 min-w-0 flex-1 rounded-sm bg-muted">
                <div
                  className="h-2 rounded-sm bg-primary/70"
                  style={{ width: count ? width : "0%" }}
                />
              </div>
              <span className="w-10 text-end tabular-nums">{count}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
