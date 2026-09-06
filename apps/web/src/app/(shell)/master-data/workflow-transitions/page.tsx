"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { PageHeader } from "@/components/shared/page-header";
import { EnterpriseButton } from "@/components/ui/button";
import { EnterpriseBadge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { DynamicStatusBadge } from "@/components/business/dynamic-status-badge";
import { useLocale } from "@/providers/locale-provider";
import type { MessageKey } from "@/i18n/translate";
import { toast } from "@/lib/toast";
import { ApiError } from "@/services/api-client";
import { workflowService, type WorkflowStatusOption } from "@/services/workflow-service";
import { WORKFLOW_TYPES, type WorkflowTypeValue } from "@/config/master-data/workflow-statuses";

interface StatusRef {
  code: string;
  name: string;
  color: string;
}

interface TransitionRow {
  id: string;
  workflowType: WorkflowTypeValue;
  labelAr: string;
  labelEn: string | null;
  requiresReason: boolean;
  requiresApproval: boolean;
  requiredPermission: string | null;
  isActive: boolean;
  isSystemProtected: boolean;
  businessAction: "NONE" | "LEAD_CONVERT" | "PAYMENT_RECONCILE" | "SHIPMENT_CREATE";
  sortOrder: number;
  fromStatus: StatusRef;
  toStatus: StatusRef;
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

const BUSINESS_ACTION_KEY: Record<TransitionRow["businessAction"], MessageKey> = {
  NONE: "workflow.transitions.businessActionNone",
  LEAD_CONVERT: "workflow.transitions.businessActionLeadConvert",
  PAYMENT_RECONCILE: "workflow.transitions.businessActionPaymentReconcile",
  SHIPMENT_CREATE: "workflow.transitions.businessActionShipmentCreate",
};

interface TransitionFormState {
  fromStatusId: string;
  toStatusId: string;
  labelAr: string;
  labelEn: string;
  requiresReason: boolean;
  requiresApproval: boolean;
  requiredPermission: string;
  sortOrder: string;
}

const emptyForm: TransitionFormState = {
  fromStatusId: "",
  toStatusId: "",
  labelAr: "",
  labelEn: "",
  requiresReason: false,
  requiresApproval: false,
  requiredPermission: "",
  sortOrder: "0",
};

function initialFormState(
  editing: TransitionRow | null,
  statuses: WorkflowStatusOption[],
): TransitionFormState {
  if (!editing) return emptyForm;
  const fromId = statuses.find((s) => s.code === editing.fromStatus.code)?.id ?? "";
  const toId = statuses.find((s) => s.code === editing.toStatus.code)?.id ?? "";
  return {
    fromStatusId: fromId,
    toStatusId: toId,
    labelAr: editing.labelAr,
    labelEn: editing.labelEn ?? "",
    requiresReason: editing.requiresReason,
    requiresApproval: editing.requiresApproval,
    requiredPermission: editing.requiredPermission ?? "",
    sortOrder: String(editing.sortOrder),
  };
}

/** Remounted via `key` on open (see caller) so each open starts from a fresh, correctly-seeded form instead of syncing state from props in an effect. */
function TransitionDialog({
  open,
  onOpenChange,
  workflowType,
  statuses,
  editing,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  workflowType: WorkflowTypeValue;
  statuses: WorkflowStatusOption[];
  editing: TransitionRow | null;
  onSaved: () => void;
}) {
  const { t } = useLocale();
  const [form, setForm] = useState<TransitionFormState>(() => initialFormState(editing, statuses));
  const [isSubmitting, setIsSubmitting] = useState(false);

  const submit = async () => {
    if (!form.labelAr.trim()) return;
    if (!editing && (!form.fromStatusId || !form.toStatusId)) return;
    setIsSubmitting(true);
    try {
      if (editing) {
        await workflowService.updateTransition(editing.id, {
          labelAr: form.labelAr.trim(),
          labelEn: form.labelEn.trim() || undefined,
          requiresReason: form.requiresReason,
          requiresApproval: editing.isSystemProtected ? undefined : form.requiresApproval,
          requiredPermission: form.requiredPermission.trim() || undefined,
          sortOrder: Number(form.sortOrder) || 0,
        });
        toast.success(t("workflow.transitions.updateSuccess"));
      } else {
        await workflowService.createTransition({
          workflowType,
          fromStatusId: form.fromStatusId,
          toStatusId: form.toStatusId,
          labelAr: form.labelAr.trim(),
          labelEn: form.labelEn.trim() || undefined,
          requiresReason: form.requiresReason,
          requiresApproval: form.requiresApproval,
          requiredPermission: form.requiredPermission.trim() || undefined,
          sortOrder: Number(form.sortOrder) || 0,
        });
        toast.success(t("workflow.transitions.createSuccess"));
      }
      onOpenChange(false);
      onSaved();
    } catch (error) {
      toast.error(error instanceof ApiError ? error.message : t("common.noResults"));
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>
            {editing ? t("workflow.transitions.edit") : t("workflow.transitions.add")}
          </DialogTitle>
          {editing?.isSystemProtected && (
            <DialogDescription>{t("workflow.transitions.protectedHint")}</DialogDescription>
          )}
        </DialogHeader>
        <div className="flex flex-col gap-4">
          {!editing && (
            <div className="grid grid-cols-2 gap-3">
              <div className="flex flex-col gap-1.5">
                <Label>{t("workflow.transitions.fromStatus")}</Label>
                <Select
                  value={form.fromStatusId}
                  onValueChange={(v) => setForm((f) => ({ ...f, fromStatusId: v }))}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {statuses.map((s) => (
                      <SelectItem key={s.id} value={s.id}>
                        {s.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="flex flex-col gap-1.5">
                <Label>{t("workflow.transitions.toStatus")}</Label>
                <Select
                  value={form.toStatusId}
                  onValueChange={(v) => setForm((f) => ({ ...f, toStatusId: v }))}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {statuses.map((s) => (
                      <SelectItem key={s.id} value={s.id}>
                        {s.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
          )}
          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1.5">
              <Label>{t("workflow.transitions.labelAr")}</Label>
              <Input
                value={form.labelAr}
                onChange={(e) => setForm((f) => ({ ...f, labelAr: e.target.value }))}
                dir="rtl"
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label>{t("workflow.transitions.labelEn")}</Label>
              <Input
                value={form.labelEn}
                onChange={(e) => setForm((f) => ({ ...f, labelEn: e.target.value }))}
              />
            </div>
          </div>
          <div className="flex flex-col gap-1.5">
            <Label>{t("workflow.transitions.requiredPermission")}</Label>
            <Input
              value={form.requiredPermission}
              onChange={(e) => setForm((f) => ({ ...f, requiredPermission: e.target.value }))}
              placeholder="crm.leads.edit"
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label>{t("workflow.transitions.sortOrder")}</Label>
            <Input
              type="number"
              value={form.sortOrder}
              onChange={(e) => setForm((f) => ({ ...f, sortOrder: e.target.value }))}
              className="w-24"
            />
          </div>
          <label className="flex items-center gap-2 text-caption">
            <Checkbox
              checked={form.requiresReason}
              onCheckedChange={(v) => setForm((f) => ({ ...f, requiresReason: v === true }))}
            />
            {t("workflow.transitions.requiresReason")}
          </label>
          <label className="flex items-center gap-2 text-caption group-has-disabled/field:opacity-50">
            <Checkbox
              checked={form.requiresApproval}
              disabled={Boolean(editing?.isSystemProtected && editing.requiresApproval)}
              onCheckedChange={(v) => setForm((f) => ({ ...f, requiresApproval: v === true }))}
            />
            {t("workflow.transitions.requiresApproval")}
          </label>
        </div>
        <DialogFooter>
          <EnterpriseButton variant="outline" onClick={() => onOpenChange(false)}>
            {t("common.cancel")}
          </EnterpriseButton>
          <EnterpriseButton onClick={submit} disabled={isSubmitting}>
            {t("common.save")}
          </EnterpriseButton>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function WorkflowTransitionsTab({ workflowType }: { workflowType: WorkflowTypeValue }) {
  const { t } = useLocale();
  const [transitions, setTransitions] = useState<TransitionRow[]>([]);
  const [statuses, setStatuses] = useState<WorkflowStatusOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<TransitionRow | null>(null);

  const reload = useCallback(() => {
    Promise.all([
      workflowService.listTransitions(workflowType) as Promise<TransitionRow[]>,
      workflowService.statusesByWorkflow(workflowType),
    ])
      .then(([tRows, sRows]) => {
        setTransitions(tRows);
        setStatuses(sRows);
      })
      .catch((error: unknown) => {
        toast.error(error instanceof ApiError ? error.message : "Failed to load");
      })
      .finally(() => setLoading(false));
  }, [workflowType]);

  useEffect(() => {
    reload();
  }, [reload]);

  const toggleActive = async (row: TransitionRow) => {
    try {
      await workflowService.updateTransition(row.id, { isActive: !row.isActive });
      toast.success(
        row.isActive
          ? t("workflow.transitions.deactivateSuccess")
          : t("workflow.transitions.activateSuccess"),
      );
      void reload();
    } catch (error) {
      toast.error(error instanceof ApiError ? error.message : t("common.noResults"));
    }
  };

  return (
    <div className="flex flex-col gap-3">
      <div className="flex justify-end">
        <EnterpriseButton
          size="sm"
          onClick={() => {
            setEditing(null);
            setDialogOpen(true);
          }}
        >
          {t("workflow.transitions.add")}
        </EnterpriseButton>
      </div>
      <section className="overflow-hidden rounded-md border border-border">
        <div className="border-b border-border px-3 py-2 text-caption text-muted-foreground">
          {loading
            ? t("common.loading")
            : `${transitions.length} ${t("workflow.transitions.title")}`}
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-caption">
            <thead className="border-b border-border text-muted-foreground">
              <tr>
                <th className="px-3 py-2 text-start font-medium">
                  {t("workflow.transitions.from")}
                </th>
                <th className="px-3 py-2 text-start font-medium"></th>
                <th className="px-3 py-2 text-start font-medium">{t("workflow.transitions.to")}</th>
                <th className="px-3 py-2 text-start font-medium">
                  {t("workflow.transitions.label")}
                </th>
                <th className="px-3 py-2 text-start font-medium">
                  {t("workflow.transitions.businessAction")}
                </th>
                <th className="px-3 py-2 text-start font-medium">
                  {t("workflow.transitions.requiresReason")}
                </th>
                <th className="px-3 py-2 text-start font-medium">
                  {t("workflow.transitions.active")}
                </th>
                <th className="px-3 py-2"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {transitions.map((row) => (
                <tr key={row.id} className="hover:bg-muted/40">
                  <td className="px-3 py-2">
                    <DynamicStatusBadge
                      label={row.fromStatus.name}
                      colorKey={row.fromStatus.color}
                    />
                  </td>
                  <td className="px-1 py-2 text-muted-foreground">→</td>
                  <td className="px-3 py-2">
                    <DynamicStatusBadge label={row.toStatus.name} colorKey={row.toStatus.color} />
                  </td>
                  <td className="px-3 py-2">{row.labelAr}</td>
                  <td className="px-3 py-2">
                    {row.businessAction !== "NONE" ? (
                      <div className="flex items-center gap-1.5">
                        <EnterpriseBadge variant="info">
                          {t(BUSINESS_ACTION_KEY[row.businessAction])}
                        </EnterpriseBadge>
                        {row.isSystemProtected && (
                          <EnterpriseBadge variant="warning">
                            {t("workflow.transitions.protected")}
                          </EnterpriseBadge>
                        )}
                      </div>
                    ) : (
                      <span className="text-muted-foreground">—</span>
                    )}
                  </td>
                  <td className="px-3 py-2">
                    {row.requiresReason ? (
                      <EnterpriseBadge variant="outline">
                        {t("workflow.transitions.requiresReason")}
                      </EnterpriseBadge>
                    ) : (
                      <span className="text-muted-foreground">—</span>
                    )}
                  </td>
                  <td className="px-3 py-2">
                    <EnterpriseBadge variant={row.isActive ? "success" : "secondary"}>
                      {t(
                        row.isActive
                          ? "workflow.transitions.active"
                          : "workflow.transitions.inactive",
                      )}
                    </EnterpriseBadge>
                  </td>
                  <td className="px-3 py-2">
                    <div className="flex justify-end gap-2">
                      <EnterpriseButton
                        size="sm"
                        variant="outline"
                        onClick={() => {
                          setEditing(row);
                          setDialogOpen(true);
                        }}
                      >
                        {t("common.edit")}
                      </EnterpriseButton>
                      {!row.isSystemProtected && (
                        <EnterpriseButton
                          size="sm"
                          variant="ghost"
                          onClick={() => toggleActive(row)}
                        >
                          {t(
                            row.isActive
                              ? "workflow.transitions.inactive"
                              : "workflow.transitions.active",
                          )}
                        </EnterpriseButton>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
      <TransitionDialog
        key={editing?.id ?? "new"}
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        workflowType={workflowType}
        statuses={statuses}
        editing={editing}
        onSaved={reload}
      />
    </div>
  );
}

export default function WorkflowTransitionsPage() {
  const { t } = useLocale();
  const [approvals, setApprovals] = useState<ApprovalRow[]>([]);

  const reloadApprovals = useCallback(() => {
    workflowService
      .pendingApprovals()
      .then((rows) => setApprovals(rows as ApprovalRow[]))
      .catch(() => undefined); // Non-fatal — approvals strip just stays empty.
  }, []);

  useEffect(() => {
    reloadApprovals();
  }, [reloadApprovals]);

  const tabs = useMemo(() => WORKFLOW_TYPES, []);

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
                        void reloadApprovals();
                      } catch (error) {
                        toast.error(error instanceof ApiError ? error.message : "Error");
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
                        void reloadApprovals();
                      } catch (error) {
                        toast.error(error instanceof ApiError ? error.message : "Error");
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

      <Tabs defaultValue="LEAD" className="flex flex-col gap-3">
        <TabsList variant="line">
          {tabs.map((workflowType) => (
            <TabsTrigger key={workflowType} value={workflowType}>
              {t(`masterData.workflowStatuses.types.${workflowType}`)}
            </TabsTrigger>
          ))}
        </TabsList>
        {tabs.map((workflowType) => (
          <TabsContent key={workflowType} value={workflowType}>
            <WorkflowTransitionsTab workflowType={workflowType} />
          </TabsContent>
        ))}
      </Tabs>
    </div>
  );
}
