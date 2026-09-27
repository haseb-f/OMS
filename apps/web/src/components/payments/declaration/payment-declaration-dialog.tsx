"use client";

import { useEffect, useRef, useState } from "react";
import { Wallet } from "lucide-react";
import { EnterpriseModal } from "@/components/shared/enterprise-modal";
import { CreateOperationFooter } from "@/components/shared/create-operation";
import { FormErrorSummary, useFocusFirstInvalid } from "@/components/shared/form-error-summary";
import { stagingIdsOf, type ReceiptUploadItem } from "@/components/business/payment-receipts-field";
import { storeOrdersService } from "@/services/store-orders-service";
import { useLocale } from "@/providers/locale-provider";
import { reportSuccess, toast } from "@/lib/toast";
import { PaymentDeclarationFields, declarationErrorItem } from "./payment-declaration-fields";
import {
  buildDeclarationPayload,
  declarationFailureToast,
  emptyDeclaration,
  newIdempotencyKey,
  remainingDeclarable,
  validateDeclaration,
  type DeclarationFormState,
} from "./declaration-logic";

/**
 * Shared Sales/Finance payment declaration dialog for an existing order —
 * replaces the old "Add Payment" voucher (no receiving account, no amount
 * re-entry for a full payment). One idempotency key per open: a retry or a
 * double click returns the same claim.
 */
export function PaymentDeclarationDialog({
  storeOrderId,
  orderCurrencyId,
  currency,
  open,
  onOpenChange,
  onDeclared,
}: {
  storeOrderId: string;
  orderCurrencyId: string;
  currency?: { code: string } | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onDeclared: () => void;
}) {
  const { t } = useLocale();
  const [context, setContext] = useState<{ total: number; claimed: number } | null>(null);
  const [state, setState] = useState<DeclarationFormState>(() => emptyDeclaration());
  const [receipts, setReceipts] = useState<ReceiptUploadItem[]>([]);
  const [showErrors, setShowErrors] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const keyRef = useRef<string>("");
  const bodyRef = useRef<HTMLDivElement>(null);
  const focusFirstInvalid = useFocusFirstInvalid(bodyRef);

  useEffect(() => {
    if (!open) return;
    keyRef.current = newIdempotencyKey();
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setState(emptyDeclaration());
    setReceipts([]);
    setShowErrors(false);
    setServerError(null);
    setContext(null);
    storeOrdersService
      .paymentContext(storeOrderId)
      .then((row) =>
        setContext({ total: Number(row.total), claimed: Number(row.claimed ?? row.paid ?? 0) }),
      )
      .catch(() => setContext(null));
  }, [open, storeOrderId]);

  const total = context?.total ?? 0;
  const alreadyDeclared = context?.claimed ?? 0;
  const remaining = remainingDeclarable(total, alreadyDeclared);
  const error = context ? validateDeclaration(state, { total, remaining }) : null;
  const uploading = receipts.some((item) => item.status === "uploading");
  const summary = [
    ...(showErrors && error ? [declarationErrorItem(error, t)] : []),
    ...(serverError ? [{ message: serverError }] : []),
  ];

  const handleSave = async () => {
    setShowErrors(true);
    setServerError(null);
    if (error) {
      focusFirstInvalid();
      return;
    }
    if (!context || uploading || isSaving) return;
    setIsSaving(true);
    try {
      const payload = buildDeclarationPayload(
        { ...state, stagedAttachmentIds: stagingIdsOf(receipts) },
        orderCurrencyId,
      );
      const result = await storeOrdersService.declarePayment(storeOrderId, payload, keyRef.current);
      // The order page re-reads its payment strip (onDeclared) — the toast only supplements it.
      reportSuccess(
        !result.created && result.payment
          ? t("paymentDeclaration.dialog.success.retry")
          : state.kind === "UNPAID"
            ? t("paymentDeclaration.dialog.success.UNPAID")
            : t("paymentDeclaration.dialog.success.PAID"),
      );
      onOpenChange(false);
      onDeclared();
    } catch (err) {
      const failure = declarationFailureToast(err, {
        permissionTitle: t("errors.PERMISSION_ERROR"),
        failed: t("paymentDeclaration.dialog.failed"),
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
      title={t("paymentDeclaration.dialog.title")}
      description={t("paymentDeclaration.dialog.description")}
      errorSummary={<FormErrorSummary errors={summary} />}
      footer={(requestClose) => (
        <CreateOperationFooter
          requestClose={requestClose}
          onSubmit={() => void handleSave()}
          isSubmitting={isSaving}
          submitDisabled={!context || uploading}
          submitLabel={t("paymentDeclaration.dialog.submit")}
        />
      )}
    >
      <div ref={bodyRef} className="flex flex-col gap-3">
        <PaymentDeclarationFields
          value={state}
          onChange={setState}
          receipts={receipts}
          onReceiptsChange={setReceipts}
          total={total}
          alreadyDeclared={alreadyDeclared}
          remaining={remaining}
          currency={currency}
          error={showErrors ? error : null}
          disabled={isSaving}
        />
      </div>
    </EnterpriseModal>
  );
}
