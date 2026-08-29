"use client";

import { useCallback, useEffect, useState } from "react";
import { PageHeader } from "@/components/shared/page-header";
import { EnterpriseButton } from "@/components/ui/button";
import { DynamicStatusBadge } from "@/components/business/dynamic-status-badge";
import { useLocale } from "@/providers/locale-provider";
import { toast } from "sonner";
import { workflowService } from "@/services/workflow-service";

interface TransitionRow {
  id: string;
  workflowType: string;
  labelAr: string;
  labelEn: string | null;
  requiresReason: boolean;
  requiresApproval: boolean;
  isActive: boolean;
  isSystemProtected: boolean;
  businessAction: string;
  fromStatus: { code: string; name: string; color: string };
  toStatus: { code: string; name: string; color: string };
}

interface ApprovalRow {
  id: string;
  entityType: string;
  entityId: string;
  requestedAt: string;
  reason: string | null;
  fromStatus: { name: string; color: string };
  toStatus: { name: string; color: string };
  requestedBy: { fullName: string } | null;
}

export default function WorkflowTransitionsPage() {
  const { t } = useLocale();
  const [transitions, setTransitions] = useState<TransitionRow[]>([]);
  const [approvals, setApprovals] = useState<ApprovalRow[]>([]);
  const [loading, setLoading] = useState(true);

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      const [tRows, aRows] = await Promise.all([
        workflowService.listTransitions() as Promise<TransitionRow[]>,
        workflowService.pendingApprovals() as Promise<ApprovalRow[]>,
      ]);
      setTransitions(tRows);
      setApprovals(aRows);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to load");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title={t("workflow.transitions.title")}
        subtitle={t("workflow.transitions.description")}
      />

      {approvals.length > 0 && (
        <section className="flex flex-col gap-3">
          <h2 className="text-body font-medium">{t("workflow.approvals.title")}</h2>
          <div className="divide-y divide-border rounded-md border border-border">
            {approvals.map((a) => (
              <div
                key={a.id}
                className="flex flex-wrap items-center justify-between gap-3 px-3 py-2"
              >
                <div className="flex flex-col gap-0.5 text-caption">
                  <span>
                    {a.entityType} · {a.requestedBy?.fullName ?? "—"}
                  </span>
                  <span className="text-muted-foreground">
                    {a.fromStatus.name} → {a.toStatus.name}
                    {a.reason ? ` · ${a.reason}` : ""}
                  </span>
                </div>
                <div className="flex gap-2">
                  <EnterpriseButton
                    size="sm"
                    onClick={async () => {
                      try {
                        await workflowService.approve(a.id);
                        toast.success(t("workflow.approvals.approved"));
                        void reload();
                      } catch (error) {
                        toast.error(error instanceof Error ? error.message : "Error");
                      }
                    }}
                  >
                    {t("workflow.approvals.approve")}
                  </EnterpriseButton>
                  <EnterpriseButton
                    size="sm"
                    variant="outline"
                    onClick={async () => {
                      try {
                        await workflowService.reject(a.id);
                        toast.success(t("workflow.approvals.rejected"));
                        void reload();
                      } catch (error) {
                        toast.error(error instanceof Error ? error.message : "Error");
                      }
                    }}
                  >
                    {t("workflow.approvals.reject")}
                  </EnterpriseButton>
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      <section className="overflow-hidden rounded-md border border-border">
        <div className="border-b border-border px-3 py-2 text-caption text-muted-foreground">
          {loading
            ? t("common.loading")
            : `${transitions.length} ${t("workflow.transitions.title")}`}
        </div>
        <div className="divide-y divide-border">
          {transitions.map((row) => (
            <div
              key={row.id}
              className="flex flex-wrap items-center gap-3 px-3 py-2 text-caption hover:bg-muted/40"
            >
              <span className="w-24 shrink-0 font-medium">{row.workflowType}</span>
              <DynamicStatusBadge label={row.fromStatus.name} colorKey={row.fromStatus.color} />
              <span className="text-muted-foreground">→</span>
              <DynamicStatusBadge label={row.toStatus.name} colorKey={row.toStatus.color} />
              <span className="min-w-0 flex-1">{row.labelAr}</span>
              <span className="text-muted-foreground">
                {[
                  row.requiresReason ? "سبب" : null,
                  row.requiresApproval ? "اعتماد" : null,
                  row.isSystemProtected ? "محمي" : null,
                  row.businessAction !== "NONE" ? row.businessAction : null,
                  row.isActive ? null : "متوقف",
                ]
                  .filter(Boolean)
                  .join(" · ") || "—"}
              </span>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
