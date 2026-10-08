"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Wallet } from "lucide-react";
import { EnterpriseModal } from "@/components/shared/enterprise-modal";
import { CreateOperationFooter } from "@/components/shared/create-operation";
import { FormErrorSummary, useFocusFirstInvalid } from "@/components/shared/form-error-summary";
import { FieldMessage } from "@/components/ui/form";
import { stagingIdsOf, type ReceiptUploadItem } from "@/components/business/payment-receipts-field";
import { declarationErrorField } from "@/components/payments/declaration/payment-declaration-fields";
import {
  declarationFailureToast,
  newIdempotencyKey,
  type DeclarationError,
} from "@/components/payments/declaration/declaration-logic";
import {
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
import { reportSuccess, toast } from "@/lib/toast";
import { AgentDeclarationFields } from "@/components/order-entry/agent/agent-declaration-fields";

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

  const errorText = (value: DeclarationError | null) =>
    value ? t(`agentPortal.declare.errors.${value}`) : null;
  const errorField = error ? declarationErrorField(error) : null;
  const summary = [
    ...(showErrors && error
      ? [{ fieldId: errorField ?? undefined, message: errorText(error)! }]
      : []),
    ...(serverError ? [{ message: serverError }] : []),
  ];

  // The shared declaration fields take the order-entry destination shape.
  const entryDestinations = useMemo(
    () =>
      destinations?.map((destination) => ({
        id: destination.id,
        label: destination.label,
        ownership: destination.ownership,
        details: destination.details,
        methodName: destination.method.name,
      })) ?? null,
    [destinations],
  );

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
        <AgentDeclarationFields
          question={t("agentPortal.declare.question")}
          value={state}
          onChange={setState}
          receipts={receipts}
          onReceiptsChange={setReceipts}
          destinations={entryDestinations}
          total={total}
          remaining={remaining}
          alreadyDeclared={alreadyDeclared}
          currency={currency}
          error={showErrors ? error : null}
          disabled={isSaving}
        />
        {showErrors && error && !errorField ? (
          <FieldMessage announce={false}>{errorText(error)}</FieldMessage>
        ) : null}
      </div>
    </EnterpriseModal>
  );
}
