"use client";

import { RelatedRecordsPanel } from "@/components/shared/related-records-panel";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Ban, CheckCircle2, Printer, Save, Trash2 } from "lucide-react";
import { EnterpriseButton } from "@/components/ui/button";
import { ConfirmationDialog } from "@/components/shared/confirmation-dialog";
import { EditorWorkspace } from "@/components/shared/detail-workspace";
import { PartnerPicker } from "@/components/business/partner-picker";
import { FinancialTransactionEditor } from "@/components/financial-transactions/financial-transaction-editor";
import type { AllocationGridLine } from "@/components/financial-transactions/allocation-grid";
import type {
  FinancialTransactionEditorConfig,
  FinancialTransactionEditorHandlers,
  FinancialTransactionEditorState,
} from "@/components/financial-transactions/financial-transaction-editor.types";
import {
  financialTransactionErrorKeys,
  translateFieldErrors,
} from "@/components/financial-transactions/financial-transaction-validation";
import { customerRefundsService } from "@/services/customer-refunds-service";
import type {
  FinancialTransactionActivityEntry,
  FinancialTransactionRow,
} from "@/services/financial-transactions-service";
import type { PartnerPickerRow } from "@/services/partners-service";
import { buildTransactionStatusOptions } from "@/config/financial-transactions/status";
import { buildReceiptPrintPayload } from "@/config/sales/receipt-print";
import { usePrintEngine } from "@/hooks/use-print-engine";
import { usePrintCompany } from "@/components/print/print-brand";
import { useUserContext } from "@/providers/user-context";
import { useLocale } from "@/providers/locale-provider";
import { useBreadcrumbLabel } from "@/providers/breadcrumb-provider";
import { reportApiError, reportSuccess } from "@/lib/toast";

function allocationToLine(
  allocation: FinancialTransactionRow["allocations"][number],
): AllocationGridLine {
  return {
    id: allocation.id,
    invoiceId: allocation.salesReturnId ?? "",
    invoiceNumber: allocation.salesReturn?.returnNumber ?? "—",
    invoiceHref: `/sales/returns/${allocation.salesReturnId ?? ""}`,
    remainingBalance: Number(allocation.allocatedAmount),
    allocatedAmount: Number(allocation.allocatedAmount),
  };
}

/**
 * Customer Refund detail — the shared `FinancialTransactionEditor` over a
 * CUSTOMER_REFUND voucher. Refunds are created from a posted Sales Return
 * ("Refund" action), so this page views/prints/cancels them; a Draft (only
 * reachable through the API) can still be edited, confirmed or deleted.
 * The allocation (which returns are paid back) is fixed once confirmed.
 */
export function RefundEditorPage({ id }: { id: string }) {
  const router = useRouter();
  const { t } = useLocale();
  const { printDocument } = usePrintEngine();
  const printCompany = usePrintCompany();
  const { user, hasPermission } = useUserContext();

  const [refund, setRefund] = useState<FinancialTransactionRow | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [isTransitioning, setIsTransitioning] = useState(false);
  const [activity, setActivity] = useState<FinancialTransactionActivityEntry[] | null | undefined>(
    undefined,
  );
  const [deleteTarget, setDeleteTarget] = useState(false);

  const [customer, setCustomer] = useState<PartnerPickerRow | null>(null);
  const [transactionDate, setTransactionDate] = useState<Date | null>(new Date());
  const [amount, setAmount] = useState(0);
  const [referenceNumber, setReferenceNumber] = useState("");
  const [notes, setNotes] = useState("");
  const [paymentSourceId, setPaymentSourceId] = useState<string | null>(null);
  const [receivingAccountId, setReceivingAccountId] = useState<string | null>(null);
  const [allocations, setAllocations] = useState<AllocationGridLine[]>([]);

  const applyRefund = useCallback((data: FinancialTransactionRow) => {
    setRefund(data);
    setCustomer(data.partner ?? null);
    setTransactionDate(new Date(data.transactionDate));
    setAmount(Number(data.amount));
    setReferenceNumber(data.referenceNumber ?? "");
    setNotes(data.notes ?? "");
    setPaymentSourceId(data.paymentSourceId);
    setReceivingAccountId(data.receivingAccountId);
    setAllocations(data.allocations.map(allocationToLine));
  }, []);

  const refreshActivity = useCallback(() => {
    customerRefundsService
      .activities(id)
      .then(setActivity)
      .catch(() => setActivity([]));
  }, [id]);

  useEffect(() => {
    const load = async () => {
      setIsLoading(true);
      try {
        applyRefund(await customerRefundsService.get(id));
      } catch (error) {
        reportApiError(error, t("errors.generic"));
      } finally {
        setIsLoading(false);
      }
    };
    void load();
    refreshActivity();
  }, [id, applyRefund, refreshActivity, t]);

  const allocatedTotal = allocations.reduce((sum, line) => sum + line.allocatedAmount, 0);

  /** Inline validation (design §8): shown under the fields after a failed Save/Confirm, updated live; entered data is never cleared. */
  const [validationMode, setValidationMode] = useState<"save" | "post" | null>(null);
  const errorKeys = (forPosting: boolean) =>
    financialTransactionErrorKeys({
      // The customer is fixed by the originating Sales Return — never edited here.
      hasParty: true,
      amount,
      allocatedTotal,
      receivingAccountId,
      forPosting,
      allocationMode: "exact",
    });

  const buildPayload = () => ({
    transactionDate: transactionDate ? transactionDate.toISOString() : undefined,
    paymentSourceId: paymentSourceId ?? undefined,
    receivingAccountId: receivingAccountId ?? undefined,
    amount,
    referenceNumber: referenceNumber || undefined,
    notes: notes || undefined,
    allocations: allocations.map((line) => ({
      invoiceId: line.invoiceId,
      allocatedAmount: line.allocatedAmount,
    })),
  });

  const handleSave = async () => {
    if (errorKeys(false)) {
      setValidationMode("save");
      return;
    }
    setValidationMode(null);
    setIsSaving(true);
    try {
      applyRefund(await customerRefundsService.update(id, buildPayload()));
      reportSuccess(t("common.saved"));
    } catch (error) {
      reportApiError(error, t("errors.generic"));
    } finally {
      setIsSaving(false);
    }
  };

  const runTransition = async (
    action: (refundId: string) => Promise<FinancialTransactionRow>,
    successKey: Parameters<typeof t>[0],
  ) => {
    setIsTransitioning(true);
    try {
      applyRefund(await action(id));
      reportSuccess(t(successKey));
      refreshActivity();
    } catch (error) {
      reportApiError(error, t("errors.generic"));
    } finally {
      setIsTransitioning(false);
    }
  };

  const handleConfirm = async () => {
    if (errorKeys(true)) {
      setValidationMode("post");
      return;
    }
    setValidationMode(null);
    await runTransition(
      (refundId) => customerRefundsService.confirm(refundId),
      "financialTransactions.toasts.confirmed",
    );
  };

  const handleDelete = async () => {
    setIsTransitioning(true);
    try {
      await customerRefundsService.remove(id);
      reportSuccess(t("financialTransactions.toasts.deleted"));
      router.push("/sales/payments?view=refunds");
    } catch (error) {
      reportApiError(error, t("errors.generic"));
    } finally {
      setIsTransitioning(false);
    }
  };

  const handlePrint = () => {
    if (!refund) return;
    printDocument(
      buildReceiptPrintPayload(refund, {
        companyName: printCompany.name,
        companyLogoUrl: printCompany.logoUrl ?? null,
        printedByName: user?.fullName ?? null,
        t,
      }),
    );
  };

  const isDraft = refund?.status === "DRAFT";

  const config: FinancialTransactionEditorConfig = useMemo(
    () => ({
      title: t("sales.refunds.editorTitle"),
      partyLabel: t("sales.refunds.partyLabel"),
      transactionType: "CUSTOMER_REFUND",
      direction: "OUT",
      docCodePreview: "CRF",
      allocationDocumentLabel: t("sales.refunds.fields.salesReturn"),
      permissions: {
        create: "sales.refunds.create",
        edit: "sales.refunds.edit",
        confirm: "sales.refunds.confirm",
        cancel: "sales.refunds.cancel",
      },
      statusOptions: buildTransactionStatusOptions(t),
      toolbarExtra: isDraft ? (
        <EnterpriseButton
          type="button"
          size="sm"
          className="gap-1.5"
          disabled={isSaving || isTransitioning}
          onClick={handleSave}
        >
          <Save className="size-3.5" />
          {t("common.save")}
        </EnterpriseButton>
      ) : null,
      workflowActions: [
        {
          key: "confirm",
          label: t("financialTransactions.actions.confirm"),
          icon: CheckCircle2,
          variant: "default",
          visibleForStatuses: ["DRAFT"],
          onAction: () => handleConfirm(),
        },
        {
          key: "cancel",
          label: t("financialTransactions.actions.cancel"),
          icon: Ban,
          variant: "destructive",
          visibleForStatuses: ["CONFIRMED"],
          confirm: {
            title: t("financialTransactions.confirmCancelTitle"),
            description: t("financialTransactions.confirmCancelDescription"),
            confirmLabel: t("financialTransactions.actions.cancel"),
            tone: "destructive",
          },
          onAction: async () => {
            await runTransition(
              (refundId) => customerRefundsService.cancel(refundId),
              "financialTransactions.toasts.cancelled",
            );
          },
        },
        {
          key: "delete",
          label: t("common.delete"),
          icon: Trash2,
          variant: "destructive",
          visibleForStatuses: ["DRAFT"],
          onAction: () => setDeleteTarget(true),
        },
        {
          key: "print",
          label: t("table.print"),
          icon: Printer,
          variant: "outline",
          onAction: () => handlePrint(),
        },
      ],
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [
      t,
      isDraft,
      isSaving,
      isTransitioning,
      refund,
      amount,
      allocations,
      transactionDate,
      paymentSourceId,
      receivingAccountId,
      referenceNumber,
      notes,
    ],
  );

  const state: FinancialTransactionEditorState = {
    document: refund,
    documentNumber: refund?.transactionNumber ?? null,
    status: refund?.status ?? "DRAFT",
    transactionDate,
    amount,
    referenceNumber,
    notes,
    paymentSourceId,
    receivingAccountId,
    allocations,
  };

  const handlers: FinancialTransactionEditorHandlers = {
    onTransactionDateChange: setTransactionDate,
    onAmountChange: setAmount,
    onReferenceNumberChange: setReferenceNumber,
    onNotesChange: setNotes,
    onPaymentSourceChange: setPaymentSourceId,
    onReceivingAccountChange: setReceivingAccountId,
    onAllocationsChange: setAllocations,
  };

  const canConfirm = hasPermission("sales.refunds.confirm");
  const canCancel = hasPermission("sales.refunds.cancel");
  const canEdit = hasPermission("sales.refunds.edit");

  useBreadcrumbLabel(refund?.transactionNumber ?? t("sales.refunds.editorTitle"));

  return (
    <EditorWorkspace>
      <RelatedRecordsPanel kind="CUSTOMER_REFUND" id={id} refreshKey={refund?.status} />

      <FinancialTransactionEditor
        config={{
          ...config,
          workflowActions: config.workflowActions.filter((action) => {
            if (action.key === "confirm" && !canConfirm) return false;
            if (action.key === "cancel" && !canCancel) return false;
            if (action.key === "delete" && (!isDraft || !canEdit)) return false;
            if (action.key === "print" && !refund) return false;
            return true;
          }),
        }}
        state={state}
        handlers={handlers}
        activity={activity}
        isLoading={isLoading}
        disabled={!isDraft || isSaving}
        isBusy={isSaving || isTransitioning}
        fieldErrors={
          validationMode ? translateFieldErrors(errorKeys(validationMode === "post"), t) : undefined
        }
        renderPartyPicker={() => (
          <PartnerPicker role="CUSTOMER" value={customer} onChange={setCustomer} disabled />
        )}
      />

      <ConfirmationDialog
        open={deleteTarget}
        onOpenChange={setDeleteTarget}
        tone="destructive"
        title={t("financialTransactions.confirmDeleteTitle")}
        description={t("financialTransactions.confirmDeleteDescription")}
        confirmLabel={t("common.delete")}
        cancelLabel={t("common.close")}
        onConfirm={async () => {
          setDeleteTarget(false);
          await handleDelete();
        }}
      />
    </EditorWorkspace>
  );
}
