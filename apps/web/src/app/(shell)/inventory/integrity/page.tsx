"use client";

import { useCallback, useEffect, useState } from "react";
import { Download, PlayCircle, ShieldCheck } from "lucide-react";
import { PageWorkspace } from "@/components/shared/page-workspace";
import { HeaderActions } from "@/components/shared/header-actions";
import { PermissionGate } from "@/components/shared/permission-gate";
import { EmptyState } from "@/components/shared/empty-state";
import { InsightCard } from "@/components/shared/insight-card";
import { SemanticValue } from "@/components/shared/semantic-value";
import { DisclosureTrigger } from "@/components/shared/disclosure-trigger";
import { CompactDetailTable, SelectFilter } from "@/components/shared/data-table";
import { StatusBadge } from "@/components/business/status-badge";
import {
  EnterpriseCard,
  EnterpriseCardAction,
  EnterpriseCardContent,
  EnterpriseCardHeader,
  EnterpriseCardTitle,
} from "@/components/ui/card";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { canViewInventoryCost } from "@/config/inventory/cost-visibility";
import {
  INTEGRITY_STATUSES,
  INTEGRITY_STATUS_TONE,
  INTEGRITY_VIEW_PERMISSION,
  integrityMetricLabel,
  integrityExportFileName,
} from "@/config/inventory/integrity";
import { useWarehouses } from "@/hooks/use-reference-data";
import { formatDateTime } from "@/lib/date";
import { downloadBlob } from "@/lib/download";
import { reportApiError, reportSuccess } from "@/lib/toast";
import { useLocale } from "@/providers/locale-provider";
import { useUserContext } from "@/providers/user-context";
import {
  inventoryIntegrityService,
  type IntegrityReport,
  type IntegrityViolation,
  type InvariantResult,
} from "@/services/inventory-integrity-service";

function InvariantCard({ invariant }: { invariant: InvariantResult }) {
  const { t } = useLocale();
  const metrics = Object.entries(invariant.metrics);
  return (
    <EnterpriseCard data-testid={`integrity-${invariant.id}`}>
      <EnterpriseCardHeader>
        <EnterpriseCardTitle className="min-w-0 text-pretty break-words">
          <SemanticValue kind="id">{invariant.id}</SemanticValue>{" "}
          {t(`inventoryIntegrity.invariants.${invariant.id}`)}
        </EnterpriseCardTitle>
        <EnterpriseCardAction>
          <StatusBadge
            tone={INTEGRITY_STATUS_TONE[invariant.status]}
            label={t(`inventoryIntegrity.status.${invariant.status}`)}
          />
        </EnterpriseCardAction>
      </EnterpriseCardHeader>
      <EnterpriseCardContent className="flex min-w-0 flex-col gap-3">
        <dl className="grid grid-cols-1 gap-x-6 gap-y-1.5 text-body-sm sm:grid-cols-2 lg:grid-cols-3">
          <div className="flex min-w-0 justify-between gap-3">
            <dt className="text-muted-foreground">{t("inventoryIntegrity.checked")}</dt>
            <dd className="num">{invariant.checked}</dd>
          </div>
          <div className="flex min-w-0 justify-between gap-3">
            <dt className="text-muted-foreground">{t("inventoryIntegrity.findings")}</dt>
            <dd className="num">{invariant.violationCount}</dd>
          </div>
          {metrics.map(([key, value]) => (
            <div key={key} className="flex min-w-0 justify-between gap-3">
              <dt className="min-w-0 break-words text-muted-foreground">
                {integrityMetricLabel(t, key)}
              </dt>
              <dd className="num shrink-0" dir="ltr">
                {value ?? "—"}
              </dd>
            </div>
          ))}
        </dl>

        {invariant.notes.length > 0 ? (
          <ul className="list-disc ps-5 text-caption text-muted-foreground" dir="ltr">
            {invariant.notes.map((note) => (
              <li key={note} className="break-words">
                {note}
              </li>
            ))}
          </ul>
        ) : null}

        {invariant.violations.length > 0 ? (
          <Collapsible defaultOpen={invariant.status === "FAIL"}>
            <CollapsibleTrigger asChild>
              <DisclosureTrigger>
                {t("inventoryIntegrity.showFindings")} ({invariant.violationCount})
              </DisclosureTrigger>
            </CollapsibleTrigger>
            <CollapsibleContent className="mt-2 flex min-w-0 flex-col gap-2">
              {invariant.truncated ? (
                <p className="text-caption text-muted-foreground">
                  {t("inventoryIntegrity.findingsShown", {
                    shown: invariant.violations.length,
                    total: invariant.violationCount,
                  })}
                </p>
              ) : null}
              <CompactDetailTable<IntegrityViolation>
                stacked
                rows={invariant.violations}
                rowKey={(row) => `${row.rule}:${invariant.violations.indexOf(row)}`}
                columns={[
                  {
                    id: "rule",
                    header: t("inventoryIntegrity.rule"),
                    cell: (row) => <SemanticValue kind="id">{row.rule}</SemanticValue>,
                  },
                  {
                    id: "severity",
                    header: t("inventoryIntegrity.severity"),
                    cell: (row) => (
                      <StatusBadge
                        tone={INTEGRITY_STATUS_TONE[row.severity]}
                        label={t(`inventoryIntegrity.status.${row.severity}`)}
                      />
                    ),
                  },
                  {
                    id: "message",
                    header: t("inventoryIntegrity.message"),
                    cell: (row) => (
                      <span className="break-words" dir="ltr">
                        {row.message}
                      </span>
                    ),
                  },
                ]}
              />
            </CollapsibleContent>
          </Collapsible>
        ) : (
          <p className="text-caption text-muted-foreground">{t("inventoryIntegrity.noFindings")}</p>
        )}
      </EnterpriseCardContent>
    </EnterpriseCard>
  );
}

function InventoryIntegrityPageContent() {
  const { t } = useLocale();
  const { hasPermission } = useUserContext();
  const canView = canViewInventoryCost(hasPermission);
  const warehouses = useWarehouses();
  const [warehouseId, setWarehouseId] = useState("");
  const [report, setReport] = useState<IntegrityReport | null>(null);
  const [isRunning, setIsRunning] = useState(false);

  const run = useCallback(
    async (announce: boolean) => {
      setIsRunning(true);
      try {
        const result = await inventoryIntegrityService.run({
          warehouseId: warehouseId || undefined,
        });
        setReport(result);
        if (announce) {
          reportSuccess(t("inventoryIntegrity.completed"), {
            description: `${t("inventoryIntegrity.overall")}: ${t(`inventoryIntegrity.summary.${result.status}`)}`,
          });
        }
      } catch (error) {
        reportApiError(error, "errors.loadFailed");
      } finally {
        setIsRunning(false);
      }
    },
    [t, warehouseId],
  );

  // Smart default: the report runs on open (and when the scope changes) — no extra click.
  useEffect(() => {
    if (!canView) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void run(false);
  }, [canView, run]);

  const exportJson = () => {
    if (!report) return;
    downloadBlob(
      new Blob([`${JSON.stringify(report, null, 2)}\n`], { type: "application/json" }),
      integrityExportFileName(report.generatedAt),
    );
    reportSuccess(t("inventoryIntegrity.exported"));
  };

  return (
    <PageWorkspace
      title={t("inventoryIntegrity.title")}
      description={t("inventoryIntegrity.description")}
      actions={
        canView ? (
          <HeaderActions
            primary={{
              key: "run",
              label: report ? t("inventoryIntegrity.rerun") : t("inventoryIntegrity.run"),
              icon: PlayCircle,
              loading: isRunning,
              disabled: isRunning,
              onSelect: () => run(true),
              testId: "integrity-run",
            }}
            secondary={[
              {
                key: "export",
                label: t("inventoryIntegrity.exportJson"),
                icon: Download,
                disabled: !report || isRunning,
                onSelect: exportJson,
              },
            ]}
          />
        ) : undefined
      }
    >
      {!canView ? (
        <EmptyState
          tone="denied"
          layout="page"
          title={t("inventoryIntegrity.title")}
          description={t("inventoryIntegrity.costRequired")}
        />
      ) : (
        <div className="flex min-w-0 flex-col gap-4">
          <div className="flex min-w-0 flex-wrap items-center gap-2">
            <SelectFilter
              label={t("assembly.fields.warehouse")}
              value={warehouseId}
              onChange={setWarehouseId}
              options={warehouses.map((warehouse) => ({
                value: warehouse.id,
                label: `${warehouse.code} — ${warehouse.name}`,
              }))}
            />
          </div>

          {report ? (
            <>
              <div className="grid min-w-0 grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
                <InsightCard
                  label={t("inventoryIntegrity.overall")}
                  value={t(`inventoryIntegrity.summary.${report.status}`)}
                  tone={INTEGRITY_STATUS_TONE[report.status]}
                  icon={ShieldCheck}
                  keepToneAtZero
                  emphasis={report.status !== "PASS"}
                  context={`${t("inventoryIntegrity.generatedAt")}: ${formatDateTime(report.generatedAt)} · ${t("inventoryIntegrity.durationMs", { ms: report.durationMs })}`}
                />
                {INTEGRITY_STATUSES.map((status) => (
                  <InsightCard
                    key={status}
                    label={t(`inventoryIntegrity.summary.${status}`)}
                    value={report.summary[status]}
                    tone={INTEGRITY_STATUS_TONE[status]}
                  />
                ))}
              </div>
              <div className="flex min-w-0 flex-col gap-3">
                {report.invariants.map((invariant) => (
                  <InvariantCard key={invariant.id} invariant={invariant} />
                ))}
              </div>
            </>
          ) : (
            <EmptyState
              icon={ShieldCheck}
              title={t("inventoryIntegrity.title")}
              description={t("inventoryIntegrity.notRun")}
            />
          )}
        </div>
      )}
    </PageWorkspace>
  );
}

export default function InventoryIntegrityPage() {
  return (
    <PermissionGate permission={INTEGRITY_VIEW_PERMISSION}>
      <InventoryIntegrityPageContent />
    </PermissionGate>
  );
}
