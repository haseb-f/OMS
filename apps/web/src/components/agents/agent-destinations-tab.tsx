"use client";

import { useCallback, useEffect, useId, useMemo, useState } from "react";
import { Plus, Wallet } from "lucide-react";
import { DetailSection } from "@/components/shared/detail-workspace";
import { EmptyState } from "@/components/shared/empty-state";
import { ErrorState } from "@/components/shared/error-state";
import { ConfirmationDialog } from "@/components/shared/confirmation-dialog";
import { EnterpriseModal } from "@/components/shared/enterprise-modal";
import { CreateOperationFooter } from "@/components/shared/create-operation";
import {
  FormCardField,
  FormCardRow,
  FormCardSection,
  FormCardStack,
} from "@/components/shared/form-card/form-card";
import { SearchableSelect } from "@/components/shared/searchable-select";
import { StackedCell } from "@/components/shared/stacked-cell";
import { EnterpriseButton } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { StatusBadge } from "@/components/business/status-badge";
import {
  CompactDetailTable,
  type CompactDetailColumn,
} from "@/components/shared/data-table/compact-detail-table";
import {
  agentsService,
  type AgentDestinationOwnership,
  type AgentPaymentDestination,
} from "@/services/agents-service";
import { usePaymentMethods } from "@/hooks/use-reference-data";
import { useLocale } from "@/providers/locale-provider";
import { useUserContext } from "@/providers/user-context";
import { apiErrorMessage, reportApiError, toast } from "@/lib/toast";
import { FieldNote } from "./field-note";

export function AgentDestinationsTab({
  agentId,
  allowAgentDestinations,
}: {
  agentId: string;
  /** From the agreement in force; null when there is none. */
  allowAgentDestinations: boolean | null;
}) {
  const { t } = useLocale();
  const { hasPermission } = useUserContext();
  const canEdit = hasPermission("agents.edit");
  const [rows, setRows] = useState<AgentPaymentDestination[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [deactivateTarget, setDeactivateTarget] = useState<AgentPaymentDestination | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoadError(null);
    try {
      setRows(await agentsService.destinations.list(agentId));
    } catch (error) {
      setLoadError(apiErrorMessage(error, "errors.loadFailed"));
    }
  }, [agentId]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  const setActive = async (row: AgentPaymentDestination, active: boolean) => {
    setBusyId(row.id);
    try {
      await agentsService.destinations.setActive(agentId, row.id, active);
      toast.success(
        active
          ? t("agents.destinations.toasts.activated")
          : t("agents.destinations.toasts.deactivated"),
      );
      setDeactivateTarget(null);
      await load();
    } catch (error) {
      reportApiError(error, "errors.generic");
    } finally {
      setBusyId(null);
    }
  };

  if (loadError) return <ErrorState description={loadError} onRetry={() => void load()} />;
  if (!rows) return null;

  const columns: CompactDetailColumn<AgentPaymentDestination>[] = [
    {
      id: "label",
      header: t("agents.destinations.label"),
      cell: (row) => (
        <StackedCell primary={row.label} secondary={row.paymentMethod?.name ?? undefined} />
      ),
    },
    {
      id: "ownership",
      header: t("agents.destinations.ownership"),
      cell: (row) => (
        <StatusBadge
          label={t(`agents.destinations.ownershipValues.${row.ownership}`)}
          tone={row.ownership === "AGENT" ? "warning" : "info"}
        />
      ),
    },
    {
      id: "status",
      header: t("agents.fields.status"),
      cell: (row) => (
        <StatusBadge
          label={row.isActive ? t("agents.destinations.active") : t("agents.destinations.inactive")}
          tone={row.isActive ? "success" : "neutral"}
        />
      ),
    },
    ...(canEdit
      ? [
          {
            id: "actions",
            header: "",
            align: "end" as const,
            cell: (row: AgentPaymentDestination) => (
              <EnterpriseButton
                type="button"
                size="sm"
                variant="outline"
                isLoading={busyId === row.id}
                disabled={busyId === row.id}
                onClick={() =>
                  row.isActive ? setDeactivateTarget(row) : void setActive(row, true)
                }
              >
                {row.isActive
                  ? t("agents.destinations.deactivate")
                  : t("agents.destinations.activate")}
              </EnterpriseButton>
            ),
          },
        ]
      : []),
  ];

  return (
    <DetailSection
      title={t("agents.destinations.title")}
      actions={
        canEdit ? (
          <EnterpriseButton type="button" size="sm" onClick={() => setCreateOpen(true)}>
            <Plus />
            {t("agents.destinations.new")}
          </EnterpriseButton>
        ) : null
      }
    >
      <p className="text-caption text-muted-foreground">{t("agents.destinations.description")}</p>
      {allowAgentDestinations === false ? (
        <Alert tone="info">
          <AlertDescription>{t("agents.destinations.agentNotAllowed")}</AlertDescription>
        </Alert>
      ) : null}
      {rows.length === 0 ? (
        <EmptyState icon={Wallet} title={t("agents.destinations.empty")} />
      ) : (
        <CompactDetailTable columns={columns} rows={rows} rowKey={(row) => row.id} />
      )}

      {createOpen ? (
        <CreateDestinationDialog
          agentId={agentId}
          allowAgent={allowAgentDestinations === true}
          onOpenChange={setCreateOpen}
          onCreated={() => void load()}
        />
      ) : null}

      <ConfirmationDialog
        open={!!deactivateTarget}
        onOpenChange={(open) => !open && setDeactivateTarget(null)}
        tone="warning"
        title={t("agents.destinations.confirmDeactivateTitle")}
        description={`${deactivateTarget?.label ?? ""} — ${t("agents.destinations.confirmDeactivateDescription")}`}
        confirmLabel={t("agents.destinations.deactivate")}
        isConfirming={!!deactivateTarget && busyId === deactivateTarget.id}
        onConfirm={() => deactivateTarget && void setActive(deactivateTarget, false)}
      />
    </DetailSection>
  );
}

function CreateDestinationDialog({
  agentId,
  allowAgent,
  onOpenChange,
  onCreated,
}: {
  agentId: string;
  allowAgent: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated: () => void;
}) {
  const { t } = useLocale();
  const fieldId = useId();
  const paymentMethods = usePaymentMethods();
  const [paymentMethodId, setPaymentMethodId] = useState("");
  const [ownership, setOwnership] = useState<AgentDestinationOwnership | "">("");
  const [label, setLabel] = useState("");
  const [details, setDetails] = useState("");
  const [showErrors, setShowErrors] = useState(false);
  const [isSaving, setIsSaving] = useState(false);

  const methodOptions = useMemo(
    () =>
      paymentMethods
        .filter((method) => method.isActive !== false)
        .map((method) => ({ value: method.id, label: method.name })),
    [paymentMethods],
  );
  const required = t("agents.agreements.errors.required");
  const valid = !!paymentMethodId && !!ownership && !!label.trim();

  const submit = async () => {
    if (!valid || !ownership) {
      setShowErrors(true);
      return;
    }
    setIsSaving(true);
    try {
      await agentsService.destinations.create(agentId, {
        paymentMethodId,
        ownership,
        label: label.trim(),
        details: details.trim() || undefined,
      });
      toast.success(t("agents.destinations.toasts.created"));
      onCreated();
      onOpenChange(false);
    } catch (error) {
      reportApiError(error, "common.failedToSave");
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <EnterpriseModal
      open
      onOpenChange={onOpenChange}
      size="md"
      layout="form-card"
      title={t("agents.destinations.new")}
      isDirty={!!(paymentMethodId || ownership || label || details)}
      footer={(requestClose) => (
        <CreateOperationFooter
          requestClose={requestClose}
          onSubmit={() => void submit()}
          isSubmitting={isSaving}
        />
      )}
    >
      <FormCardStack>
        <FormCardSection title={t("agents.destinations.title")}>
          <FormCardRow>
            <FormCardField
              size="md"
              required
              label={t("agents.destinations.method")}
              htmlFor={`${fieldId}-method`}
              message={<FieldNote error={showErrors && !paymentMethodId ? required : null} />}
            >
              <SearchableSelect
                id={`${fieldId}-method`}
                value={paymentMethodId}
                onValueChange={setPaymentMethodId}
                options={methodOptions}
                placeholder={t("agents.agreements.choose")}
                error={showErrors && !paymentMethodId}
              />
            </FormCardField>
            <FormCardField
              size="md"
              required
              label={t("agents.destinations.ownership")}
              htmlFor={`${fieldId}-ownership`}
              message={<FieldNote error={showErrors && !ownership ? required : null} />}
            >
              <SearchableSelect
                id={`${fieldId}-ownership`}
                value={ownership}
                onValueChange={(value) => setOwnership(value as AgentDestinationOwnership)}
                placeholder={t("agents.agreements.choose")}
                error={showErrors && !ownership}
                options={(["COMPANY", "AGENT"] as const)
                  .filter((value) => value === "COMPANY" || allowAgent)
                  .map((value) => ({
                    value,
                    label: t(`agents.destinations.ownershipValues.${value}`),
                  }))}
              />
            </FormCardField>
          </FormCardRow>
          {!allowAgent ? (
            <p className="text-caption text-muted-foreground">
              {t("agents.destinations.agentNotAllowed")}
            </p>
          ) : null}
          <FormCardField
            required
            label={t("agents.destinations.label")}
            htmlFor={`${fieldId}-label`}
            message={
              <FieldNote
                error={showErrors && !label.trim() ? required : null}
                hint={t("agents.destinations.labelHint")}
              />
            }
          >
            <Input
              id={`${fieldId}-label`}
              value={label}
              aria-invalid={showErrors && !label.trim()}
              onChange={(event) => setLabel(event.target.value)}
            />
          </FormCardField>
          <FormCardField
            label={t("agents.destinations.details")}
            htmlFor={`${fieldId}-details`}
            message={<FieldNote hint={t("agents.destinations.detailsHint")} />}
          >
            <Textarea
              id={`${fieldId}-details`}
              rows={3}
              value={details}
              onChange={(event) => setDetails(event.target.value)}
            />
          </FormCardField>
        </FormCardSection>
      </FormCardStack>
    </EnterpriseModal>
  );
}
