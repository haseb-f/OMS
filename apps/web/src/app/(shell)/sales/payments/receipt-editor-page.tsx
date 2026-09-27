"use client";

import { RelatedRecordsPanel } from "@/components/shared/related-records-panel";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Ban, CheckCircle2, Printer, Save, Trash2 } from "lucide-react";
import { EnterpriseButton } from "@/components/ui/button";
import { ConfirmationDialog } from "@/components/shared/confirmation-dialog";
import { EditorWorkspace } from "@/components/shared/detail-workspace";
import { PartnerPicker } from "@/components/business/partner-picker";
import { FinancialTransactionEditor } from "@/components/financial-transactions/financial-transaction-editor";
import { OpenInvoicesTable } from "@/components/financial-transactions/open-invoices-table";
import { AllocationSummary } from "@/components/financial-transactions/allocation-summary";
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
import {
  customerReceiptsService,
  type FinancialTransactionActivityEntry,
  type FinancialTransactionRow,
  type OpenInvoiceRow,
} from "@/services/customer-receipts-service";
import { partnersService, type PartnerPickerRow } from "@/services/partners-service";
import { buildTransactionStatusOptions } from "@/config/financial-transactions/status";
import { buildReceiptPrintPayload } from "@/config/sales/receipt-print";
import { usePrintEngine } from "@/hooks/use-print-engine";
import { useCompany } from "@/providers/company-provider";
import { useUserContext } from "@/providers/user-context";
import { useLocale } from "@/providers/locale-provider";
import { useBreadcrumbLabel } from "@/providers/breadcrumb-provider";
import { reportApiError, reportSuccess } from "@/lib/toast";

let nextLineId = 1;

function allocationToLine(
  allocation: FinancialTransactionRow["allocations"][number],
): AllocationGridLine {
  return {
    id: allocation.id,
    invoiceId: allocation.salesInvoiceId ?? "",
    invoiceNumber: allocation.salesInvoice?.invoiceNumber ?? "—",
    invoiceHref: `/sales/invoices/${allocation.salesInvoiceId ?? ""}`,
    remainingBalance: Number(allocation.allocatedAmount),
    allocatedAmount: Number(allocation.allocatedAmount),
  };
}

/** Mirrors the Sales document editor pages' structure — the body here is an Allocation Grid, not a product-line grid (no line items in a financial transaction). */
export function ReceiptEditorPage({ id }: { id: string | null }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { t } = useLocale();
  const { printDocument } = usePrintEngine();
  const { activeCompany } = useCompany();
  const { user, hasPermission } = useUserContext();

  const [receipt, setReceipt] = useState<FinancialTransactionRow | null>(null);
  const [isLoading, setIsLoading] = useState(!!id);
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

  const [openInvoices, setOpenInvoices] = useState<OpenInvoiceRow[]>([]);
  const [isLoadingOpenInvoices, setIsLoadingOpenInvoices] = useState(false);
  const appliedInvoicePrefillRef = useRef(false);
  /** Synchronous double-click guard for Confirm on a new voucher. */
  const confirmingRef = useRef(false);

  const applyReceipt = useCallback((data: FinancialTransactionRow) => {
    setReceipt(data);
    setCustomer(data.partner ?? null);
    setTransactionDate(new Date(data.transactionDate));
    setAmount(Number(data.amount));
    setReferenceNumber(data.referenceNumber ?? "");
    setNotes(data.notes ?? "");
    setPaymentSourceId(data.paymentSourceId);
    setReceivingAccountId(data.receivingAccountId);
    setAllocations(data.allocations.map(allocationToLine));
  }, []);

  useEffect(() => {
    if (!id) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setIsLoading(false);
      setActivity([]);
      return;
    }
    const load = async () => {
      setIsLoading(true);
      try {
        applyReceipt(await customerReceiptsService.get(id));
      } catch (error) {
        reportApiError(error, "errors.loadFailed");
      } finally {
        setIsLoading(false);
      }
    };
    void load();
  }, [id, applyReceipt]);

  /** Deep-link prefill for the "New Receipt"/"Receive Payment" buttons (Customer Profile, Sales Invoice) — only applies on a brand-new receipt. */
  useEffect(() => {
    if (id || customer) return;
    const prefillCustomerId = searchParams.get("partnerId");
    if (!prefillCustomerId) return;
    // Picker-scoped lookup (not `.get`, which needs `partners.view`) so a
    // Finance user following the deep link still gets the party prefilled.
    partnersService
      .catalog({ ids: [prefillCustomerId], pageSize: 1, role: ["CUSTOMER"] })
      .then((result) => setCustomer(result.items[0] ?? null))
      .catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, searchParams]);

  const refreshActivity = useCallback((receiptId: string) => {
    customerReceiptsService
      .activities(receiptId)
      .then(setActivity)
      .catch(() => setActivity([]));
  }, []);

  useEffect(() => {
    if (id) refreshActivity(id);
  }, [id, refreshActivity]);

  useEffect(() => {
    if (!customer) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setOpenInvoices([]);
      return;
    }
    setIsLoadingOpenInvoices(true);
    customerReceiptsService
      .openInvoices(customer.id)
      .then(setOpenInvoices)
      .catch(() => setOpenInvoices([]))
      .finally(() => setIsLoadingOpenInvoices(false));
  }, [customer]);

  const allocatedTotal = allocations.reduce((sum, line) => sum + line.allocatedAmount, 0);
  const unallocatedAmount = Math.max(amount - allocatedTotal, 0);

  /**
   * Inline validation (design §8): after a failed Save/Confirm the messages
   * sit under their fields and update live as the user fixes them — entered
   * data is never cleared. Posting also needs to know where the money
   * went/came from, checked before any request so Confirm never half-succeeds.
   */
  const [validationMode, setValidationMode] = useState<"save" | "post" | null>(null);
  const errorKeys = (forPosting: boolean) =>
    financialTransactionErrorKeys({
      hasParty: customer !== null,
      amount,
      allocatedTotal,
      receivingAccountId,
      forPosting,
    });

  const buildPayload = () => ({
    partnerId: customer!.id,
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
      if (id) {
        const updated = await customerReceiptsService.update(id, buildPayload());
        applyReceipt(updated);
        reportSuccess(t("common.saved"));
      } else {
        const created = await customerReceiptsService.create(buildPayload());
        reportSuccess(t("common.saved"));
        router.replace(`/sales/payments/${created.id}`);
      }
    } catch (error) {
      reportApiError(error, "errors.generic");
    } finally {
      setIsSaving(false);
    }
  };

  const runTransition = async (
    action: (receiptId: string) => Promise<FinancialTransactionRow>,
    successKey: Parameters<typeof t>[0],
  ) => {
    if (!id) return;
    setIsTransitioning(true);
    try {
      const updated = await action(id);
      applyReceipt(updated);
      reportSuccess(t(successKey));
      refreshActivity(id);
    } catch (error) {
      reportApiError(error, "errors.generic");
    } finally {
      setIsTransitioning(false);
    }
  };

  /** "Confirm" on a brand-new, not-yet-saved receipt must create it first — `runTransition` alone silently no-ops with no `id` yet. Reuses the exact same `create()`/`confirm()` calls Save and a post-save Confirm already use, never a parallel path. */
  const handleConfirmExisting = async () => {
    if (errorKeys(true)) {
      setValidationMode("post");
      return;
    }
    setValidationMode(null);
    await runTransition(
      (transactionId) => customerReceiptsService.confirm(transactionId),
      "financialTransactions.toasts.confirmed",
    );
  };

  const handleConfirmNew = async () => {
    if (errorKeys(true)) {
      setValidationMode("post");
      return;
    }
    setValidationMode(null);
    if (confirmingRef.current) return;
    confirmingRef.current = true;
    setIsTransitioning(true);
    try {
      const confirmed = await customerReceiptsService.createConfirmed(buildPayload());
      reportSuccess(t("financialTransactions.toasts.confirmed"));
      router.replace(`/sales/payments/${confirmed.id}`);
    } catch (error) {
      reportApiError(error, "errors.generic");
    } finally {
      confirmingRef.current = false;
      setIsTransitioning(false);
    }
  };

  /** While Draft, allocation edits are local (persisted on Save). Once Confirmed, each add/remove/amount-edit calls Allocate/Unallocate immediately (no header re-save exists for a Confirmed transaction). */
  const handleAllocationsChange = async (nextLines: AllocationGridLine[]) => {
    if (!receipt || receipt.status === "DRAFT") {
      setAllocations(nextLines);
      return;
    }
    const prevById = new Map(allocations.map((l) => [l.id, l]));
    const nextById = new Map(nextLines.map((l) => [l.id, l]));
    setIsTransitioning(true);
    try {
      for (const prev of allocations) {
        const next = nextById.get(prev.id);
        if (!next) {
          await customerReceiptsService.unallocate(receipt.id, prev.id);
        } else if (next.allocatedAmount !== prev.allocatedAmount) {
          await customerReceiptsService.unallocate(receipt.id, prev.id);
          await customerReceiptsService.allocate(receipt.id, {
            invoiceId: next.invoiceId,
            allocatedAmount: next.allocatedAmount,
          });
        }
      }
      for (const next of nextLines) {
        if (!prevById.has(next.id)) {
          await customerReceiptsService.allocate(receipt.id, {
            invoiceId: next.invoiceId,
            allocatedAmount: next.allocatedAmount,
          });
        }
      }
      const refreshed = await customerReceiptsService.get(receipt.id);
      applyReceipt(refreshed);
      reportSuccess(t("financialTransactions.toasts.allocated"));
    } catch (error) {
      reportApiError(error, "errors.generic");
    } finally {
      setIsTransitioning(false);
    }
  };

  const handleAllocateInvoice = (invoice: OpenInvoiceRow) => {
    const existing = allocations.find((line) => line.invoiceId === invoice.invoiceId);
    const currentUnallocated = Math.max(
      amount - allocatedTotal + (existing?.allocatedAmount ?? 0),
      0,
    );
    const defaultAmount = Math.min(invoice.remainingBalance, currentUnallocated);
    if (defaultAmount <= 0) return;

    if (existing) {
      void handleAllocationsChange(
        allocations.map((line) =>
          line.id === existing.id ? { ...line, allocatedAmount: defaultAmount } : line,
        ),
      );
      return;
    }
    const newLine: AllocationGridLine = {
      id: `row-${nextLineId++}`,
      invoiceId: invoice.invoiceId,
      invoiceNumber: invoice.invoiceNumber,
      invoiceHref: `/sales/invoices/${invoice.invoiceId}`,
      remainingBalance: invoice.remainingBalance,
      allocatedAmount: defaultAmount,
    };
    void handleAllocationsChange([...allocations, newLine]);
  };

  /** Deep-link prefill for the "Receive Payment" button on a Sales Invoice — sets the amount to the invoice's remaining balance and allocates it in full. Runs once, only on a brand-new receipt. */
  useEffect(() => {
    if (id || appliedInvoicePrefillRef.current) return;
    const prefillInvoiceId = searchParams.get("invoiceId");
    if (!prefillInvoiceId || openInvoices.length === 0) return;
    const invoice = openInvoices.find((inv) => inv.invoiceId === prefillInvoiceId);
    if (!invoice) return;
    appliedInvoicePrefillRef.current = true;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setAmount(invoice.remainingBalance);
    setAllocations([
      {
        id: `row-${nextLineId++}`,
        invoiceId: invoice.invoiceId,
        invoiceNumber: invoice.invoiceNumber,
        invoiceHref: `/sales/invoices/${invoice.invoiceId}`,
        remainingBalance: invoice.remainingBalance,
        allocatedAmount: invoice.remainingBalance,
      },
    ]);
  }, [id, searchParams, openInvoices]);

  const handlePayAllRemaining = () => {
    let remaining = unallocatedAmount;
    const nextLines = [...allocations];
    for (const invoice of openInvoices) {
      if (remaining <= 0) break;
      const existingIndex = nextLines.findIndex((line) => line.invoiceId === invoice.invoiceId);
      const already = existingIndex >= 0 ? nextLines[existingIndex].allocatedAmount : 0;
      const capacity = invoice.remainingBalance - already;
      if (capacity <= 0) continue;
      const toApply = Math.min(capacity, remaining);
      const nextAmount = already + toApply;
      if (existingIndex >= 0) {
        nextLines[existingIndex] = { ...nextLines[existingIndex], allocatedAmount: nextAmount };
      } else {
        nextLines.push({
          id: `row-${nextLineId++}`,
          invoiceId: invoice.invoiceId,
          invoiceNumber: invoice.invoiceNumber,
          invoiceHref: `/sales/invoices/${invoice.invoiceId}`,
          remainingBalance: invoice.remainingBalance,
          allocatedAmount: nextAmount,
        });
      }
      remaining -= toApply;
    }
    void handleAllocationsChange(nextLines);
    reportSuccess(t("financialTransactions.toasts.payAllRemainingApplied"));
  };

  /** Hard delete — Draft only, server-enforced. Unlike Cancel (Confirmed → Cancelled, keeps the record), this removes the draft entirely; there is nothing to reverse since a Draft never posted. */
  const handleDelete = async () => {
    if (!id) return;
    setIsTransitioning(true);
    try {
      await customerReceiptsService.remove(id);
      reportSuccess(t("financialTransactions.toasts.deleted"));
      router.push("/sales/payments");
    } catch (error) {
      reportApiError(error, "errors.generic");
    } finally {
      setIsTransitioning(false);
    }
  };

  const handlePrint = () => {
    if (!receipt) return;
    printDocument(
      buildReceiptPrintPayload(receipt, {
        companyName: activeCompany?.name ?? "",
        companyLogoUrl: activeCompany?.logoUrl ?? null,
        printedByName: user?.fullName ?? null,
        t,
      }),
    );
  };

  const config: FinancialTransactionEditorConfig = useMemo(
    () => ({
      title: t("sales.receipts.editorTitle"),
      partyLabel: t("sales.receipts.partyLabel"),
      transactionType: "CUSTOMER_RECEIPT",
      direction: "IN",
      docCodePreview: "CR",
      permissions: {
        create: "sales.receipts.create",
        edit: "sales.receipts.edit",
        confirm: "sales.receipts.confirm",
        cancel: "sales.receipts.cancel",
      },
      statusOptions: buildTransactionStatusOptions(t),
      toolbarExtra: (
        <EnterpriseButton
          type="button"
          size="sm"
          className="gap-1.5"
          disabled={isSaving || isTransitioning || (!!receipt && receipt.status !== "DRAFT")}
          onClick={handleSave}
        >
          <Save className="size-3.5" />
          {t("common.save")}
        </EnterpriseButton>
      ),
      workflowActions: [
        {
          key: "confirm",
          label: t("financialTransactions.actions.confirm"),
          icon: CheckCircle2,
          variant: "default",
          visibleForStatuses: ["DRAFT"],
          onAction: () => (id ? handleConfirmExisting() : handleConfirmNew()),
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
              (rid) => customerReceiptsService.cancel(rid),
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
      isSaving,
      isTransitioning,
      receipt,
      customer,
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
    document: receipt,
    documentNumber: receipt?.transactionNumber ?? null,
    status: receipt?.status ?? "DRAFT",
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
    onAllocationsChange: handleAllocationsChange,
  };

  const canEdit = !receipt || receipt.status === "DRAFT";
  const canConfirm = hasPermission("sales.receipts.confirm");
  const canCancel = hasPermission("sales.receipts.cancel");

  useBreadcrumbLabel(receipt?.transactionNumber ?? t("sales.receipts.addNew"));

  return (
    <EditorWorkspace>
      <RelatedRecordsPanel kind="CUSTOMER_RECEIPT" id={id} refreshKey={receipt?.status} />

      <FinancialTransactionEditor
        config={{
          ...config,
          // confirmingRef is only read inside click handlers, never during render.
          // eslint-disable-next-line react-hooks/refs
          workflowActions: config.workflowActions.filter((action) => {
            if (action.key === "confirm" && !canConfirm) return false;
            if (action.key === "cancel" && !canCancel) return false;
            if (action.key === "delete" && (!receipt || !canEdit)) return false;
            if (action.key === "print" && !receipt) return false;
            return true;
          }),
        }}
        state={state}
        handlers={handlers}
        activity={activity}
        isLoading={isLoading}
        disabled={!canEdit || isSaving}
        isBusy={isSaving || isTransitioning}
        fieldErrors={
          validationMode ? translateFieldErrors(errorKeys(validationMode === "post"), t) : undefined
        }
        renderPartyPicker={({ disabled }) => (
          <PartnerPicker
            role="CUSTOMER"
            value={customer}
            onChange={setCustomer}
            disabled={disabled}
          />
        )}
        allocationSection={
          <div className="flex flex-col gap-3">
            <AllocationSummary
              openInvoiceCount={openInvoices.length}
              totalRemaining={openInvoices.reduce((sum, inv) => sum + inv.remainingBalance, 0)}
            />
            <OpenInvoicesTable
              invoices={openInvoices}
              isLoading={isLoadingOpenInvoices}
              disabled={!canEdit && receipt?.status !== "CONFIRMED"}
              onAllocate={handleAllocateInvoice}
              onPayAllRemaining={handlePayAllRemaining}
            />
          </div>
        }
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
