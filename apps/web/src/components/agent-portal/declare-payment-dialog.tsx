"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";
import { Wallet } from "lucide-react";
import { EnterpriseModal } from "@/components/shared/enterprise-modal";
import { CreateOperationFooter } from "@/components/shared/create-operation";
import { FormErrorSummary, useFocusFirstInvalid } from "@/components/shared/form-error-summary";
import { FormSection, AmountStrip } from "@/components/documents/form-section";
import { SegmentedRadioGroup } from "@/components/documents/segmented-radio-group";
import { Field, FieldGrid } from "@/components/shared/form-card/form-card";
import { SearchableSelect } from "@/components/shared/searchable-select";
import { EnterpriseDatePicker } from "@/components/shared/date-picker";
import { MoneyValue } from "@/components/shared/money-value";
import { MoneyInput } from "@/components/shared/money-input";
import { FieldMessage, RequiredMark } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  PaymentReceiptsField,
  stagingIdsOf,
  type ReceiptUploadItem,
} from "@/components/business/payment-receipts-field";
import { declarationErrorField } from "@/components/payments/declaration/payment-declaration-fields";
import {
  declarationFailureToast,
  newIdempotencyKey,
  type DeclarationError,
  type DeclarationKind,
} from "@/components/payments/declaration/declaration-logic";
import {
  agentDeclarationAmount,
  buildAgentDeclarationPayload,
  emptyAgentDeclaration,
  validateAgentDeclaration,
  type AgentDeclarationState,
} from "@/config/agent-portal/declaration";
import {
  agentPortalService,
  type PortalDestination,
  type PortalOrderDetail,
} from "@/services/agent-portal-service";
import { useLocale } from "@/providers/locale-provider";
import { fromISODate, toISODate } from "@/lib/date";
import { reportSuccess, toast } from "@/lib/toast";
import { OwnershipBadge } from "./portal-badges";

const KINDS: DeclarationKind[] = ["UNPAID", "FULL", "PARTIAL"];

/**
 * "Declare payment" on an agent order (spec §6.2, `agent.payments.declare`):
 * Unpaid / Paid in full (= the remaining payable, read-only) / Partially
 * paid (explicit amount ≤ remaining), the agent's authorized destination,
 * payment date, reference and proof. One idempotency key per open — a retry
 * or double click keeps one claim. A declaration is never a verification.
 */
export function DeclarePaymentDialog({
  order,
  open,
  onOpenChange,
  onDeclared,
}: {
  order: PortalOrderDetail;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onDeclared: (next: PortalOrderDetail) => void;
}) {
  const { t } = useLocale();
  const fieldId = useId();
  const [state, setState] = useState<AgentDeclarationState>(() => emptyAgentDeclaration());
  const [receipts, setReceipts] = useState<ReceiptUploadItem[]>([]);
  const [destinations, setDestinations] = useState<PortalDestination[] | null>(null);
  const [showErrors, setShowErrors] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const keyRef = useRef("");
  const bodyRef = useRef<HTMLDivElement>(null);
  const focusFirstInvalid = useFocusFirstInvalid(bodyRef);

  useEffect(() => {
    if (!open) return;
    keyRef.current = newIdempotencyKey();
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setState(emptyAgentDeclaration());
    setReceipts([]);
    setShowErrors(false);
    setServerError(null);
    agentPortalService
      .paymentDestinations()
      .then(setDestinations)
      .catch(() => setDestinations([]));
  }, [open]);

  const currency = order.currency;
  const total = order.breakdown.payableTotal;
  const alreadyDeclared = order.payment.declaredAmount;
  const remaining = order.payment.remainingToDeclare;
  const error = validateAgentDeclaration(state, { total, remaining });
  const uploading = receipts.some((item) => item.status === "uploading");
  const paid = state.kind !== "UNPAID";
  const set = (patch: Partial<AgentDeclarationState>) =>
    setState((prev) => ({ ...prev, ...patch }));

  const errorText = (value: DeclarationError | null) =>
    value ? t(`agentPortal.declare.errors.${value}`) : null;
  const errorField = error ? declarationErrorField(error) : null;
  const fieldError = (name: string) =>
    showErrors && errorField === name ? errorText(error) : null;
  const summary = [
    ...(showErrors && error
      ? [{ fieldId: errorField ?? undefined, message: errorText(error)! }]
      : []),
    ...(serverError ? [{ message: serverError }] : []),
  ];

  const options = useMemo(
    () =>
      (destinations ?? []).map((destination) => ({
        value: destination.id,
        label: destination.label,
        description: [
          t(`agentPortal.status.ownership.${destination.ownership}`),
          destination.method.name,
          destination.details,
        ]
          .filter(Boolean)
          .join(" · "),
      })),
    [destinations, t],
  );
  const selected = destinations?.find((destination) => destination.id === state.destinationId);

  const handleSave = async () => {
    setShowErrors(true);
    setServerError(null);
    if (error) {
      focusFirstInvalid();
      return;
    }
    if (uploading || isSaving) return;
    setIsSaving(true);
    try {
      const next = await agentPortalService.orders.declare(
        order.id,
        buildAgentDeclarationPayload(state, stagingIdsOf(receipts), keyRef.current),
      );
      reportSuccess(
        state.kind === "UNPAID"
          ? t("agentPortal.declare.success.UNPAID")
          : t("agentPortal.declare.success.PAID"),
      );
      onDeclared(next);
      onOpenChange(false);
    } catch (err) {
      const failure = declarationFailureToast(err, {
        permissionTitle: t("errors.PERMISSION_ERROR"),
        failed: t("agentPortal.declare.failed"),
      });
      setServerError(
        failure.description ? `${failure.title} — ${failure.description}` : failure.title,
      );
      toast.error(
        failure.title,
        failure.description ? { description: failure.description } : undefined,
      );
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <EnterpriseModal
      open={open}
      onOpenChange={onOpenChange}
      size="md"
      icon={Wallet}
      title={t("agentPortal.declare.title")}
      description={t("agentPortal.declare.description")}
      isDirty={paid && (!!state.destinationId || receipts.length > 0)}
      errorSummary={<FormErrorSummary errors={summary} />}
      footer={(requestClose) => (
        <CreateOperationFooter
          requestClose={requestClose}
          onSubmit={() => void handleSave()}
          isSubmitting={isSaving}
          submitDisabled={uploading || destinations === null}
          submitLabel={t("agentPortal.declare.submit")}
        />
      )}
    >
      <div ref={bodyRef} className="flex flex-col gap-3">
        <FormSection
          title={<span id={`${fieldId}-question`}>{t("agentPortal.declare.question")}</span>}
        >
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
            <SegmentedRadioGroup
              value={state.kind}
              onValueChange={(kind) => set({ kind })}
              disabled={isSaving}
              aria-labelledby={`${fieldId}-question`}
              options={KINDS.map((kind) => ({
                value: kind,
                label: t(`agentPortal.declare.kinds.${kind}`),
              }))}
            />
            {paid ? (
              <p className="text-caption text-muted-foreground">
                {state.kind === "FULL"
                  ? t("agentPortal.declare.fullHint")
                  : t("agentPortal.declare.partialHint")}
              </p>
            ) : null}
          </div>

          {paid ? (
            <>
              <FieldGrid className="grid grid-cols-1 gap-x-3 gap-y-2 @md:grid-cols-2">
                <Field
                  size="sm"
                  data-field-name="declarationAmount"
                  data-invalid={fieldError("declarationAmount") ? "true" : undefined}
                >
                  <Label htmlFor={`${fieldId}-amount`}>
                    {state.kind === "FULL"
                      ? t("agentPortal.declare.fullAmount")
                      : t("agentPortal.declare.amount")}
                    {state.kind === "PARTIAL" ? <RequiredMark className="ms-0.5" /> : null}
                  </Label>
                  <MoneyInput
                    id={`${fieldId}-amount`}
                    value={state.kind === "FULL" ? String(remaining) : state.amount}
                    readOnly={state.kind === "FULL"}
                    disabled={isSaving}
                    aria-invalid={Boolean(fieldError("declarationAmount")) || undefined}
                    onChange={(event) => set({ amount: event.target.value })}
                  />
                  <FieldMessage announce={false}>{fieldError("declarationAmount")}</FieldMessage>
                </Field>
                <Field
                  size="md"
                  data-field-name="declarationMethod"
                  data-invalid={fieldError("declarationMethod") ? "true" : undefined}
                >
                  <Label htmlFor={`${fieldId}-destination`}>
                    {t("agentPortal.declare.destination")} <RequiredMark className="ms-0.5" />
                  </Label>
                  <SearchableSelect
                    id={`${fieldId}-destination`}
                    value={state.destinationId}
                    onValueChange={(destinationId) => set({ destinationId })}
                    options={options}
                    loading={destinations === null}
                    placeholder={t("agentPortal.declare.chooseDestination")}
                    emptyText={t("agentPortal.declare.noDestinations")}
                    disabled={isSaving}
                    error={Boolean(fieldError("declarationMethod"))}
                  />
                  <FieldMessage announce={false}>{fieldError("declarationMethod")}</FieldMessage>
                </Field>
                <Field
                  size="sm"
                  data-field-name="declarationDate"
                  data-invalid={fieldError("declarationDate") ? "true" : undefined}
                >
                  <Label htmlFor={`${fieldId}-date`}>
                    {t("agentPortal.declare.paymentDate")} <RequiredMark className="ms-0.5" />
                  </Label>
                  <EnterpriseDatePicker
                    id={`${fieldId}-date`}
                    value={fromISODate(state.paymentDate)}
                    onChange={(date) => set({ paymentDate: date ? toISODate(date) : "" })}
                    disabled={isSaving}
                    aria-invalid={Boolean(fieldError("declarationDate")) || undefined}
                  />
                  <FieldMessage announce={false}>{fieldError("declarationDate")}</FieldMessage>
                </Field>
                <Field size="md">
                  <Label htmlFor={`${fieldId}-reference`}>
                    {t("agentPortal.declare.reference")}
                  </Label>
                  <Input
                    id={`${fieldId}-reference`}
                    dir="ltr"
                    value={state.reference}
                    disabled={isSaving}
                    onChange={(event) => set({ reference: event.target.value })}
                  />
                </Field>
              </FieldGrid>

              {selected ? (
                <div className="flex flex-wrap items-center gap-2 rounded-md border border-border bg-muted/30 px-3 py-2 text-caption">
                  <OwnershipBadge ownership={selected.ownership} />
                  <span className="font-medium">{selected.label}</span>
                  <span className="text-muted-foreground">{selected.method.name}</span>
                  {selected.details ? (
                    <span className="min-w-0 break-words text-muted-foreground" dir="auto">
                      {selected.details}
                    </span>
                  ) : null}
                </div>
              ) : null}

              <PaymentReceiptsField items={receipts} onChange={setReceipts} disabled={isSaving} />
              <AmountStrip
                items={[
                  {
                    key: "total",
                    label: t("agentPortal.declare.payable"),
                    value: <MoneyValue value={total} currency={currency} />,
                  },
                  ...(alreadyDeclared > 0
                    ? [
                        {
                          key: "declared",
                          label: t("agentPortal.declare.alreadyDeclared"),
                          value: <MoneyValue value={alreadyDeclared} currency={currency} />,
                        },
                      ]
                    : []),
                  {
                    key: "will",
                    label: t("agentPortal.declare.willDeclare"),
                    value: (
                      <MoneyValue
                        value={agentDeclarationAmount(state, remaining)}
                        currency={currency}
                      />
                    ),
                    strong: true,
                  },
                ]}
              />
            </>
          ) : null}
          {showErrors && error && !errorField ? (
            <FieldMessage announce={false}>{errorText(error)}</FieldMessage>
          ) : null}
        </FormSection>
      </div>
    </EnterpriseModal>
  );
}
