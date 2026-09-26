"use client";

import { useCallback, useEffect, useId, useState } from "react";
import { Landmark, RefreshCw, Search, Tag, CheckCircle2, Undo2 } from "lucide-react";
import { PageWorkspace } from "@/components/shared/page-workspace";
import { EmptyState } from "@/components/shared/empty-state";
import { ListSurface, ListToolbar } from "@/components/shared/data-table/list-surface";
import { EnterpriseModal } from "@/components/shared/enterprise-modal";
import { ConfirmationDialog } from "@/components/shared/confirmation-dialog";
import { EnterpriseButton } from "@/components/ui/button";
import { LoadingOverlay } from "@/components/shared/loading-overlay";
import { KpiCard } from "@/components/shared/kpi-card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { AccountPicker } from "@/components/business/account-picker";
import { PartnerPicker } from "@/components/business/partner-picker";
import { SearchableSelect } from "@/components/shared/searchable-select";
import { cachedLookup } from "@/lib/lookup-cache";
import { EntityCombobox } from "@/components/shared/entity-combobox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
} from "@/components/ui/table";
import { StatusBadge, type StatusTone } from "@/components/business/status-badge";
import { ModuleImportButtons } from "@/components/shared/module-import-buttons";
import { SyncButton } from "@/components/shared/sync-button";
import { PermissionGate } from "@/components/shared/permission-gate";
import { RowActionsMenu } from "@/components/shared/data-table";
import { useLocale } from "@/providers/locale-provider";
import { useUserContext } from "@/providers/user-context";
import { toast, reportApiError } from "@/lib/toast";
import { formatDate } from "@/lib/date";
import {
  bankTransactionsService,
  type BankTransactionRow,
  type BankTransactionMatchStatus,
  type BankTransactionMatchCandidate,
  type CashFlowDirection,
  type CashFlowOutgoingType,
  type CashFlowSummary,
} from "@/services/bank-transactions-service";
import {
  paymentSourcesService,
  type PaymentSourceOption,
} from "@/services/payment-sources-service";
import { storeOrdersService, type StoreOrderRow } from "@/services/store-orders-service";
import { salesInvoicesService, type SalesInvoiceRow } from "@/services/sales-invoices-service";
import {
  purchaseInvoicesService,
  type PurchaseInvoiceRow,
} from "@/services/purchase-invoices-service";
import type { PartnerRow } from "@/services/partners-service";
import type { ChartOfAccountRow } from "@/config/master-data/entities";
import type { MessageKey } from "@/i18n/translate";

const INCOMING_STATUS_TABS: BankTransactionMatchStatus[] = [
  "UNMATCHED",
  "POTENTIAL",
  "MANUAL_REVIEW",
  "MATCHED",
  "CONFLICT",
];
const OUTGOING_STATUS_TABS: BankTransactionMatchStatus[] = [
  "UNMATCHED",
  "POTENTIAL",
  "MANUAL_REVIEW",
  "MATCHED",
  "CONFLICT",
];

const STATUS_LABEL_KEY: Record<BankTransactionMatchStatus, MessageKey> = {
  UNMATCHED: "masterData.bankTransactions.status.UNMATCHED",
  POTENTIAL: "masterData.bankTransactions.status.POTENTIAL",
  PARTIALLY_MATCHED: "masterData.bankTransactions.status.PARTIALLY_MATCHED",
  MATCHED: "masterData.bankTransactions.status.MATCHED",
  DUPLICATE: "masterData.bankTransactions.status.DUPLICATE",
  CONFLICT: "masterData.bankTransactions.status.CONFLICT",
  MANUAL_REVIEW: "masterData.bankTransactions.status.MANUAL_REVIEW",
};

const STATUS_TONE: Record<BankTransactionMatchStatus, StatusTone> = {
  UNMATCHED: "neutral",
  POTENTIAL: "warning",
  PARTIALLY_MATCHED: "warning",
  MATCHED: "success",
  DUPLICATE: "destructive",
  CONFLICT: "destructive",
  MANUAL_REVIEW: "destructive",
};

function formatMoney(value: string, currencyCode: string | undefined) {
  const num = Number(value);
  return `${num.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}${currencyCode ? ` ${currencyCode}` : ""}`;
}

function CashFlowPageContent() {
  const { t } = useLocale();
  const { hasPermission } = useUserContext();
  const canManage = hasPermission("accounting.bank-transactions.manage");
  const canUnreconcile = hasPermission("accounting.bank-transactions.unreconcile");

  const [direction, setDirection] = useState<CashFlowDirection>("INCOMING");
  const [statusFilter, setStatusFilter] = useState<BankTransactionMatchStatus>("UNMATCHED");
  const [items, setItems] = useState<BankTransactionRow[]>([]);
  const [counts, setCounts] = useState<Record<BankTransactionMatchStatus, number>>({
    UNMATCHED: 0,
    POTENTIAL: 0,
    PARTIALLY_MATCHED: 0,
    MATCHED: 0,
    DUPLICATE: 0,
    CONFLICT: 0,
    MANUAL_REVIEW: 0,
  });
  const [summary, setSummary] = useState<CashFlowSummary | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isRunningMatch, setIsRunningMatch] = useState(false);
  const [reconcileTarget, setReconcileTarget] = useState<BankTransactionRow | null>(null);
  const [classifyTarget, setClassifyTarget] = useState<BankTransactionRow | null>(null);
  const [unreconcileTarget, setUnreconcileTarget] = useState<BankTransactionRow | null>(null);
  const [unreconcileReason, setUnreconcileReason] = useState("");
  const [isUnreconciling, setIsUnreconciling] = useState(false);

  const statusTabs = direction === "INCOMING" ? INCOMING_STATUS_TABS : OUTGOING_STATUS_TABS;

  const load = useCallback(async () => {
    setIsLoading(true);
    try {
      const [list, statusCounts, cashFlowSummary] = await Promise.all([
        bankTransactionsService.list({ direction, matchStatus: statusFilter, pageSize: 100 }),
        bankTransactionsService.statusCounts(direction),
        bankTransactionsService.cashFlowSummary(),
      ]);
      setItems(list.items);
      setCounts(statusCounts);
      setSummary(cashFlowSummary);
    } catch (error) {
      reportApiError(error, t("common.loadFailed"));
    } finally {
      setIsLoading(false);
    }
  }, [direction, statusFilter, t]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  const handleRunMatching = async () => {
    setIsRunningMatch(true);
    try {
      const result = await bankTransactionsService.runMatching();
      toast.success(
        t("masterData.bankTransactions.matchingRunSuccess", { count: result.classified }),
      );
      await load();
    } catch (error) {
      reportApiError(error, t("common.failedToSave"));
    } finally {
      setIsRunningMatch(false);
    }
  };

  const handleUnreconcile = async () => {
    if (!unreconcileTarget || !unreconcileReason.trim()) return;
    setIsUnreconciling(true);
    try {
      await bankTransactionsService.unreconcile(unreconcileTarget.id, unreconcileReason.trim());
      toast.success(t("masterData.bankTransactions.unreconcile.success"));
      setUnreconcileTarget(null);
      setUnreconcileReason("");
      await load();
    } catch (error) {
      reportApiError(error, t("common.failedToSave"));
    } finally {
      setIsUnreconciling(false);
    }
  };

  return (
    <PageWorkspace
      dense
      title={t("masterData.bankTransactions.title")}
      description={t("masterData.bankTransactions.description")}
      actions={
        <div className="flex items-center gap-2">
          <SyncButton sourceType="CASH_FLOW" onSynced={load} />
          <ModuleImportButtons importType="BANK_TRANSACTIONS" onImported={load} />
          {canManage && direction === "INCOMING" && (
            <EnterpriseButton
              type="button"
              variant="outline"
              onClick={handleRunMatching}
              disabled={isRunningMatch}
            >
              <RefreshCw className={isRunningMatch ? "animate-spin" : undefined} />
              {t("masterData.bankTransactions.runMatching")}
            </EnterpriseButton>
          )}
        </div>
      }
    >
      <Tabs
        value={direction}
        onValueChange={(value) => {
          setDirection(value as CashFlowDirection);
          setStatusFilter("UNMATCHED");
        }}
      >
        <TabsList>
          <TabsTrigger value="INCOMING">
            {t("masterData.bankTransactions.tabs.incoming")}
          </TabsTrigger>
          <TabsTrigger value="OUTGOING">
            {t("masterData.bankTransactions.tabs.outgoing")}
          </TabsTrigger>
        </TabsList>
      </Tabs>

      {summary && (
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-5">
          {direction === "INCOMING" ? (
            <>
              <KpiCard
                icon={Landmark}
                label={t("masterData.bankTransactions.summary.total")}
                value={summary.incoming.total}
                tone="info"
              />
              <KpiCard
                icon={Landmark}
                label={t("masterData.bankTransactions.summary.matched")}
                value={summary.incoming.matched}
                tone="success"
              />
              <KpiCard
                icon={Landmark}
                label={t("masterData.bankTransactions.summary.unmatched")}
                value={summary.incoming.unmatched}
                tone="muted"
              />
              <KpiCard
                icon={Landmark}
                label={t("masterData.bankTransactions.summary.storeOrderMatches")}
                value={summary.incoming.storeOrderMatches}
                tone="success"
              />
              <KpiCard
                icon={Landmark}
                label={t("masterData.bankTransactions.summary.b2bMatches")}
                value={summary.incoming.b2bSalesInvoiceMatches}
                tone="info"
              />
            </>
          ) : (
            <>
              <KpiCard
                icon={Landmark}
                label={t("masterData.bankTransactions.summary.total")}
                value={summary.outgoing.total}
                tone="info"
              />
              <KpiCard
                icon={Landmark}
                label={t("masterData.bankTransactions.summary.supplierPayments")}
                value={summary.outgoing.supplierPayments}
                tone="success"
              />
              <KpiCard
                icon={Landmark}
                label={t("masterData.bankTransactions.summary.expenses")}
                value={summary.outgoing.expenses}
                tone="info"
              />
              <KpiCard
                icon={Landmark}
                label={t("masterData.bankTransactions.summary.unclassified")}
                value={summary.outgoing.unclassified}
                tone="muted"
              />
              <KpiCard
                icon={Landmark}
                label={t("masterData.bankTransactions.summary.posted")}
                value={summary.outgoing.posted}
                tone="success"
              />
            </>
          )}
        </div>
      )}

      <ListSurface>
        {isLoading && <LoadingOverlay />}
        <ListToolbar>
          {statusTabs.map((status) => (
            <EnterpriseButton
              key={status}
              type="button"
              variant={statusFilter === status ? "secondary" : "outline"}
              size="sm"
              onClick={() => setStatusFilter(status)}
            >
              {t(STATUS_LABEL_KEY[status])} ({counts[status]})
            </EnterpriseButton>
          ))}
        </ListToolbar>
        {items.length === 0 && !isLoading ? (
          <EmptyState icon={Landmark} title={t("masterData.bankTransactions.empty")} />
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t("masterData.bankTransactions.fields.date")}</TableHead>
                <TableHead>{t("masterData.bankTransactions.fields.transactionId")}</TableHead>
                <TableHead>{t("masterData.bankTransactions.fields.cashSource")}</TableHead>
                <TableHead>{t("masterData.bankTransactions.fields.description")}</TableHead>
                <TableHead>{t("masterData.bankTransactions.fields.amount")}</TableHead>
                {direction === "OUTGOING" && (
                  <TableHead>{t("masterData.bankTransactions.fields.classification")}</TableHead>
                )}
                <TableHead>{t("common.status")}</TableHead>
                <TableHead>{t("common.actions")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {items.map((row) => (
                <TableRow key={row.id}>
                  <TableCell>{formatDate(row.transactionDate)}</TableCell>
                  <TableCell dir="ltr">{row.transactionId ?? "—"}</TableCell>
                  <TableCell>{row.cashSource?.name ?? row.bankName ?? "—"}</TableCell>
                  <TableCell className="max-w-64 truncate">{row.description ?? "—"}</TableCell>
                  <TableCell dir="ltr">{formatMoney(row.amount, row.currency?.code)}</TableCell>
                  {direction === "OUTGOING" && (
                    <TableCell>
                      {row.outgoingType
                        ? t(
                            row.outgoingType === "EXPENSE"
                              ? "masterData.bankTransactions.classifyDialog.expense"
                              : "masterData.bankTransactions.classifyDialog.supplierPayment",
                          )
                        : "—"}
                    </TableCell>
                  )}
                  <TableCell>
                    <StatusBadge
                      label={t(STATUS_LABEL_KEY[row.matchStatus])}
                      tone={STATUS_TONE[row.matchStatus]}
                    />
                  </TableCell>
                  <TableCell>
                    {row.matchStatus === "MATCHED" ? (
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-caption text-muted-foreground" dir="ltr">
                          {row.matchedPayment?.paymentNumber ??
                            row.matchedFinancialTransaction?.transactionNumber}
                        </span>
                        {canUnreconcile && (
                          <RowActionsMenu
                            label={t("common.actions")}
                            actions={[
                              {
                                key: "unreconcile",
                                label: t("masterData.bankTransactions.unreconcile.action"),
                                icon: Undo2,
                                destructive: true,
                                onSelect: () => setUnreconcileTarget(row),
                              },
                            ]}
                          />
                        )}
                      </div>
                    ) : (
                      canManage && (
                        <RowActionsMenu
                          label={t("common.actions")}
                          actions={[
                            {
                              key: "classify",
                              label: t("masterData.bankTransactions.classify"),
                              icon: Tag,
                              hidden: !(direction === "OUTGOING" && !row.outgoingType),
                              onSelect: () => setClassifyTarget(row),
                            },
                            {
                              key: "reconcile",
                              label: t("masterData.bankTransactions.reconcile"),
                              icon: CheckCircle2,
                              hidden: !(direction === "INCOMING" || !!row.outgoingType),
                              onSelect: () => setReconcileTarget(row),
                            },
                          ]}
                        />
                      )
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </ListSurface>

      {classifyTarget && (
        <ClassifyDialog
          transaction={classifyTarget}
          onClose={() => setClassifyTarget(null)}
          onDone={() => {
            setClassifyTarget(null);
            void load();
          }}
        />
      )}

      {reconcileTarget && (
        <ReconcileDialog
          transaction={reconcileTarget}
          onClose={() => setReconcileTarget(null)}
          onDone={() => {
            setReconcileTarget(null);
            void load();
          }}
        />
      )}

      <ConfirmationDialog
        open={!!unreconcileTarget}
        onOpenChange={(open) => {
          if (!open) {
            setUnreconcileTarget(null);
            setUnreconcileReason("");
          }
        }}
        tone="destructive"
        title={t("masterData.bankTransactions.unreconcile.title")}
        description={
          unreconcileTarget
            ? `${t("masterData.bankTransactions.unreconcile.impact")} ${formatMoney(unreconcileTarget.amount, unreconcileTarget.currency?.code)}`
            : undefined
        }
        extra={
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="unreconcile-reason">
              {t("masterData.bankTransactions.unreconcile.reasonLabel")}
            </Label>
            <Textarea
              id="unreconcile-reason"
              value={unreconcileReason}
              onChange={(event) => setUnreconcileReason(event.target.value)}
              rows={2}
            />
          </div>
        }
        confirmLabel={t("masterData.bankTransactions.unreconcile.confirm")}
        confirmDisabled={!unreconcileReason.trim()}
        isConfirming={isUnreconciling}
        onConfirm={handleUnreconcile}
      />
    </PageWorkspace>
  );
}

// ---------------------------------------------------------------------------
// Classify Outgoing dialog (spec section 9/12)
// ---------------------------------------------------------------------------

function ClassifyDialog({
  transaction,
  onClose,
  onDone,
}: {
  transaction: BankTransactionRow;
  onClose: () => void;
  onDone: () => void;
}) {
  const { t } = useLocale();
  const [outgoingType, setOutgoingType] = useState<CashFlowOutgoingType>("EXPENSE");
  const [supplier, setSupplier] = useState<PartnerRow | null>(null);
  const [expenseAccount, setExpenseAccount] = useState<ChartOfAccountRow | null>(null);
  const outgoingTypeId = useId();
  const expenseAccountFieldId = useId();
  const supplierFieldId = useId();
  const [saving, setSaving] = useState(false);

  const handleSave = async () => {
    setSaving(true);
    try {
      await bankTransactionsService.classifyOutgoing(transaction.id, {
        outgoingType,
        expenseAccountId: outgoingType === "EXPENSE" ? expenseAccount?.id : undefined,
        partnerId: outgoingType === "SUPPLIER_PAYMENT" ? supplier?.id : undefined,
      });
      toast.success(t("masterData.bankTransactions.classifyDialog.saved"));
      onDone();
    } catch (error) {
      reportApiError(error, "Failed to classify.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <EnterpriseModal
      open
      onOpenChange={(open) => !open && onClose()}
      size="md"
      icon={Landmark}
      title={t("masterData.bankTransactions.classifyDialog.title")}
      description={`${formatDate(transaction.transactionDate)} — ${formatMoney(transaction.amount, transaction.currency?.code)}`}
      footer={(requestClose) => (
        <>
          <EnterpriseButton type="button" variant="ghost" onClick={requestClose} disabled={saving}>
            {t("common.cancel")}
          </EnterpriseButton>
          <EnterpriseButton
            type="button"
            onClick={handleSave}
            disabled={saving || (outgoingType === "EXPENSE" ? !expenseAccount : !supplier)}
          >
            {t("masterData.bankTransactions.classifyDialog.save")}
          </EnterpriseButton>
        </>
      )}
    >
      <div className="flex flex-col gap-4">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor={outgoingTypeId}>
            {t("masterData.bankTransactions.classifyDialog.outgoingType")}
          </Label>
          <Select
            value={outgoingType}
            onValueChange={(v) => setOutgoingType(v as CashFlowOutgoingType)}
          >
            <SelectTrigger id={outgoingTypeId} className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="EXPENSE">
                {t("masterData.bankTransactions.classifyDialog.expense")}
              </SelectItem>
              <SelectItem value="SUPPLIER_PAYMENT">
                {t("masterData.bankTransactions.classifyDialog.supplierPayment")}
              </SelectItem>
            </SelectContent>
          </Select>
        </div>

        {outgoingType === "EXPENSE" ? (
          <div className="flex flex-col gap-1.5">
            <Label htmlFor={expenseAccountFieldId}>
              {t("masterData.bankTransactions.classifyDialog.expenseAccount")}
            </Label>
            <AccountPicker
              id={expenseAccountFieldId}
              accountType="EXPENSE"
              value={expenseAccount}
              onChange={setExpenseAccount}
              placeholder={t("masterData.bankTransactions.manual.searchExpenseAccount")}
            />
          </div>
        ) : (
          <div className="flex flex-col gap-1.5">
            <Label htmlFor={supplierFieldId}>
              {t("masterData.bankTransactions.classifyDialog.supplier")}
            </Label>
            <PartnerPicker
              id={supplierFieldId}
              role="SUPPLIER"
              value={supplier}
              onChange={setSupplier}
            />
          </div>
        )}
      </div>
    </EnterpriseModal>
  );
}

// ---------------------------------------------------------------------------
// Reconcile dialog — Incoming (Store Order / B2B Invoice) and Outgoing
// (Purchase Invoice / Expense Voucher), spec sections 6/7/10/11.
// ---------------------------------------------------------------------------

function ReconcileDialog({
  transaction,
  onClose,
  onDone,
}: {
  transaction: BankTransactionRow;
  onClose: () => void;
  onDone: () => void;
}) {
  const { t } = useLocale();
  const isIncoming = transaction.direction !== "OUTGOING";
  const isExpense = transaction.outgoingType === "EXPENSE";

  const [candidates, setCandidates] = useState<BankTransactionMatchCandidate[] | null>(null);
  const [loadingCandidates, setLoadingCandidates] = useState(!isExpense);
  const [paymentSources, setPaymentSources] = useState<PaymentSourceOption[]>([]);
  const [paymentSourcesLoading, setPaymentSourcesLoading] = useState(true);
  const [paymentSourceId, setPaymentSourceId] = useState<string | null>(null);
  const paymentSourceFieldId = useId();
  const [busy, setBusy] = useState(false);
  const [manualPicker, setManualPicker] = useState<
    "STORE_ORDER" | "SALES_INVOICE" | "PURCHASE_INVOICE" | null
  >(null);
  const [mismatchCandidate, setMismatchCandidate] = useState<BankTransactionMatchCandidate | null>(
    null,
  );
  const [mismatchMode, setMismatchMode] = useState<"match" | "update" | null>(null);
  // Partial / multi-invoice allocation — SALES_INVOICE/PURCHASE_INVOICE
  // candidates only. Each selected candidate carries its own editable
  // allocation amount; the backend already accepts an array of
  // {invoiceId, allocatedAmount} and caps each at the invoice's live
  // remaining balance and the transaction's own amount.
  const [selectedInvoiceIds, setSelectedInvoiceIds] = useState<Set<string>>(new Set());
  const [allocationDrafts, setAllocationDrafts] = useState<Record<string, string>>({});
  const [allocating, setAllocating] = useState(false);
  // Net-receipt / bank-fee settlement (Part G) — incoming only. Recording a
  // fee raises how much the selected invoices can be allocated (amount +
  // fee) without inflating the actual cash receipt.
  const [feeEnabled, setFeeEnabled] = useState(false);
  const [feeAmountDraft, setFeeAmountDraft] = useState("");
  const [feeAccount, setFeeAccount] = useState<ChartOfAccountRow | null>(null);
  // Internal Transfer (Part H) — a movement between two of the company's
  // own Financial Accounts, never Revenue/Expense. Works from either an
  // incoming or outgoing unmatched row.
  const [transferCandidates, setTransferCandidates] = useState<
    Awaited<ReturnType<typeof bankTransactionsService.suggestInternalTransfer>>["candidates"] | null
  >(null);
  const [loadingTransfer, setLoadingTransfer] = useState(false);
  const [confirmingTransferId, setConfirmingTransferId] = useState<string | null>(null);

  useEffect(() => {
    // One fetch per dialog mount, deduped session-wide by `paymentSourcesService.list` (cachedLookup).
    let cancelled = false;
    paymentSourcesService
      .list()
      .then((rows) => {
        if (!cancelled) setPaymentSources(rows);
      })
      .catch(() => {
        if (!cancelled) setPaymentSources([]);
      })
      .finally(() => {
        if (!cancelled) setPaymentSourcesLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (isExpense) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setLoadingCandidates(true);
    const suggest = isIncoming
      ? bankTransactionsService.suggestIncoming(transaction.id)
      : bankTransactionsService.suggestOutgoing(transaction.id);
    suggest
      .then((result) => setCandidates(result.candidates))
      .catch(() => setCandidates([]))
      .finally(() => setLoadingCandidates(false));
  }, [transaction.id, isIncoming, isExpense]);

  const confirmCandidate = async (
    candidate: BankTransactionMatchCandidate,
    opts?: { acknowledgeMethodMismatch?: boolean; updateExpectedPaymentSource?: boolean },
  ) => {
    if (!paymentSourceId && candidate.kind !== "PAYMENT") {
      toast.error(t("masterData.bankTransactions.voucher.paymentSource"));
      return;
    }
    if (
      candidate.kind === "STORE_ORDER" &&
      candidate.methodMismatch &&
      !opts?.acknowledgeMethodMismatch
    ) {
      setMismatchCandidate(candidate);
      return;
    }
    setBusy(true);
    try {
      if (candidate.kind === "PAYMENT") {
        await bankTransactionsService.confirmMatch(transaction.id, candidate.id);
      } else if (candidate.kind === "STORE_ORDER") {
        await bankTransactionsService.confirmStoreOrderPayment(transaction.id, {
          storeOrderId: candidate.id,
          paymentSourceId: paymentSourceId!,
          acknowledgeMethodMismatch: opts?.acknowledgeMethodMismatch,
          updateExpectedPaymentSource: opts?.updateExpectedPaymentSource,
        });
        toast.success(t("masterData.bankTransactions.voucher.storeOrderPaymentCreated"));
      } else if (candidate.kind === "SALES_INVOICE") {
        await bankTransactionsService.confirmSalesInvoiceReceipt(transaction.id, {
          allocations: [
            { invoiceId: candidate.id, allocatedAmount: Math.abs(Number(transaction.amount)) },
          ],
          paymentSourceId: paymentSourceId ?? undefined,
        });
        toast.success(t("masterData.bankTransactions.voucher.receiptCreated"));
      } else {
        await bankTransactionsService.confirmPurchaseInvoicePayment(transaction.id, {
          allocations: [
            { invoiceId: candidate.id, allocatedAmount: Math.abs(Number(transaction.amount)) },
          ],
          paymentSourceId: paymentSourceId ?? undefined,
        });
        toast.success(t("masterData.bankTransactions.voucher.supplierPaymentCreated"));
      }
      setMismatchCandidate(null);
      onDone();
    } catch (error) {
      reportApiError(error, "Failed to reconcile.");
    } finally {
      setBusy(false);
      setMismatchMode(null);
    }
  };

  const confirmExpenseVoucher = async () => {
    setBusy(true);
    try {
      await bankTransactionsService.confirmExpenseVoucher(transaction.id, {
        paymentSourceId: paymentSourceId ?? undefined,
      });
      toast.success(t("masterData.bankTransactions.voucher.expenseVoucherCreated"));
      onDone();
    } catch (error) {
      reportApiError(error, "Failed to create voucher.");
    } finally {
      setBusy(false);
    }
  };

  const transactionAmount = Math.abs(Number(transaction.amount));
  const round2 = (value: number) => Math.round(value * 100) / 100;
  const invoiceCandidates = (candidates ?? []).filter(
    (c) => c.kind === "SALES_INVOICE" || c.kind === "PURCHASE_INVOICE",
  );
  const otherCandidates = (candidates ?? []).filter(
    (c) => c.kind === "PAYMENT" || c.kind === "STORE_ORDER",
  );
  const feeAmountValue = feeEnabled ? Number(feeAmountDraft) || 0 : 0;
  const totalAllocated = round2(
    [...selectedInvoiceIds].reduce((sum, id) => sum + (Number(allocationDrafts[id]) || 0), 0),
  );
  const remainingUnallocated = round2(transactionAmount + feeAmountValue - totalAllocated);

  const toggleInvoiceCandidate = (candidate: BankTransactionMatchCandidate, checked: boolean) => {
    setSelectedInvoiceIds((previous) => {
      const next = new Set(previous);
      if (checked) next.add(candidate.id);
      else next.delete(candidate.id);
      return next;
    });
    if (checked && !allocationDrafts[candidate.id]) {
      const currentlyAllocated = [...selectedInvoiceIds].reduce(
        (sum, id) => sum + (Number(allocationDrafts[id]) || 0),
        0,
      );
      const available = round2(transactionAmount - currentlyAllocated);
      const defaultAmount = round2(
        Math.max(0, Math.min(candidate.outstanding ?? available, available)),
      );
      setAllocationDrafts((previous) => ({ ...previous, [candidate.id]: String(defaultAmount) }));
    }
  };

  const confirmAllocations = async () => {
    const allocations = [...selectedInvoiceIds]
      .map((id) => ({ invoiceId: id, allocatedAmount: Number(allocationDrafts[id]) || 0 }))
      .filter((a) => a.allocatedAmount > 0);
    if (allocations.length === 0) {
      toast.error(t("masterData.bankTransactions.allocation.selectAtLeastOne"));
      return;
    }
    if (!paymentSourceId) {
      toast.error(t("masterData.bankTransactions.voucher.paymentSource"));
      return;
    }
    if (feeEnabled && (!feeAmountValue || !feeAccount)) {
      toast.error(t("masterData.bankTransactions.allocation.feeAccountRequired"));
      return;
    }
    setAllocating(true);
    try {
      if (isIncoming) {
        await bankTransactionsService.confirmSalesInvoiceReceipt(transaction.id, {
          allocations,
          paymentSourceId,
          feeAmount: feeEnabled ? feeAmountValue : undefined,
          feeAccountId: feeEnabled ? (feeAccount?.id ?? undefined) : undefined,
        });
        toast.success(t("masterData.bankTransactions.voucher.receiptCreated"));
      } else {
        await bankTransactionsService.confirmPurchaseInvoicePayment(transaction.id, {
          allocations,
          paymentSourceId,
        });
        toast.success(t("masterData.bankTransactions.voucher.supplierPaymentCreated"));
      }
      onDone();
    } catch (error) {
      reportApiError(error, "Failed to reconcile.");
    } finally {
      setAllocating(false);
    }
  };

  const findTransferCandidates = async () => {
    setLoadingTransfer(true);
    try {
      const result = await bankTransactionsService.suggestInternalTransfer(transaction.id);
      setTransferCandidates(result.candidates);
    } catch (error) {
      reportApiError(error, "Failed to search.");
    } finally {
      setLoadingTransfer(false);
    }
  };

  const confirmTransfer = async (pairedId: string) => {
    setConfirmingTransferId(pairedId);
    try {
      await bankTransactionsService.confirmInternalTransfer(transaction.id, pairedId);
      toast.success(t("masterData.bankTransactions.transfer.confirmed"));
      onDone();
    } catch (error) {
      reportApiError(error, "Failed to reconcile.");
    } finally {
      setConfirmingTransferId(null);
    }
  };

  const candidateLabelKey: Record<BankTransactionMatchCandidate["kind"], MessageKey> = {
    PAYMENT: "masterData.bankTransactions.candidates.payment",
    STORE_ORDER: "masterData.bankTransactions.candidates.storeOrder",
    SALES_INVOICE: "masterData.bankTransactions.candidates.salesInvoice",
    PURCHASE_INVOICE: "masterData.bankTransactions.candidates.purchaseInvoice",
  };

  return (
    <>
      <EnterpriseModal
        open
        onOpenChange={(open) => !open && onClose()}
        size="lg"
        icon={Landmark}
        title={t("masterData.bankTransactions.reconcile")}
        description={`${formatDate(transaction.transactionDate)} — ${formatMoney(transaction.amount, transaction.currency?.code)}`}
        footer={(requestClose) => (
          <EnterpriseButton type="button" variant="ghost" onClick={requestClose} disabled={busy}>
            {t("common.cancel")}
          </EnterpriseButton>
        )}
      >
        <div className="flex flex-col gap-4">
          {transaction.description && (
            <p className="text-caption text-muted-foreground">{transaction.description}</p>
          )}

          <div className="flex flex-col gap-1.5">
            <Label htmlFor={paymentSourceFieldId}>
              {t("masterData.bankTransactions.voucher.paymentSource")}
            </Label>
            <SearchableSelect
              id={paymentSourceFieldId}
              value={paymentSourceId}
              onValueChange={(next) => setPaymentSourceId(next || null)}
              options={paymentSources.map((source) => ({ value: source.id, label: source.name }))}
              loading={paymentSourcesLoading}
              placeholder={t("common.select")}
            />
          </div>

          {isExpense ? (
            <EnterpriseButton type="button" onClick={confirmExpenseVoucher} disabled={busy}>
              {t("masterData.bankTransactions.voucher.createExpenseVoucher")}
            </EnterpriseButton>
          ) : (
            <>
              {loadingCandidates ? (
                <p className="text-caption text-muted-foreground">{t("common.loading")}</p>
              ) : !candidates || candidates.length === 0 ? (
                <p className="text-caption text-muted-foreground">
                  {t("masterData.bankTransactions.noCandidates")}
                </p>
              ) : (
                <>
                  {otherCandidates.length > 0 && (
                    <div className="flex flex-col gap-2">
                      {otherCandidates.map((candidate) => (
                        <div
                          key={`${candidate.kind}-${candidate.id}`}
                          className="flex items-center justify-between gap-3 rounded-md border border-border p-3"
                        >
                          <div className="flex flex-col gap-1">
                            <span className="text-[0.65rem] text-muted-foreground">
                              {t(candidateLabelKey[candidate.kind])}
                            </span>
                            <span className="font-medium" dir="ltr">
                              {candidate.label}
                            </span>
                            <span className="text-caption text-muted-foreground">
                              {candidate.reasons.join(" · ")}
                            </span>
                            {candidate.methodMismatch && (
                              <span className="text-caption text-warning">
                                {t("masterData.bankTransactions.methodMismatch")}
                                {candidate.expectedPaymentSourceName
                                  ? ` — ${candidate.expectedPaymentSourceName}`
                                  : ""}
                              </span>
                            )}
                          </div>
                          <EnterpriseButton
                            type="button"
                            size="sm"
                            onClick={() => confirmCandidate(candidate)}
                            disabled={busy}
                          >
                            {t("masterData.bankTransactions.candidates.confirm")}
                          </EnterpriseButton>
                        </div>
                      ))}
                    </div>
                  )}

                  {invoiceCandidates.length > 0 && (
                    <div className="flex flex-col gap-2">
                      <p className="text-caption font-medium text-muted-foreground">
                        {t("masterData.bankTransactions.allocation.title")}
                      </p>
                      {invoiceCandidates.map((candidate) => {
                        const selected = selectedInvoiceIds.has(candidate.id);
                        return (
                          <div
                            key={`${candidate.kind}-${candidate.id}`}
                            className="flex items-center gap-3 rounded-md border border-border p-3"
                          >
                            <Checkbox
                              checked={selected}
                              onCheckedChange={(checked) =>
                                toggleInvoiceCandidate(candidate, checked === true)
                              }
                            />
                            <div className="flex flex-1 flex-col gap-1">
                              <span className="text-[0.65rem] text-muted-foreground">
                                {t(candidateLabelKey[candidate.kind])}
                              </span>
                              <span className="font-medium" dir="ltr">
                                {candidate.label}
                              </span>
                              <span className="text-caption text-muted-foreground">
                                {candidate.reasons.join(" · ")}
                                {candidate.outstanding !== undefined
                                  ? ` · ${t("masterData.bankTransactions.allocation.outstanding")}: ${formatMoney(String(candidate.outstanding), transaction.currency?.code)}`
                                  : ""}
                              </span>
                            </div>
                            {selected && (
                              <Input
                                type="number"
                                min={0}
                                step="0.01"
                                dir="ltr"
                                className="w-32"
                                value={allocationDrafts[candidate.id] ?? ""}
                                onChange={(e) =>
                                  setAllocationDrafts((previous) => ({
                                    ...previous,
                                    [candidate.id]: e.target.value,
                                  }))
                                }
                              />
                            )}
                          </div>
                        );
                      })}
                      {isIncoming && (
                        <div className="flex flex-col gap-2 rounded-md border border-border p-3">
                          <label className="flex items-center gap-2 text-caption">
                            <Checkbox
                              checked={feeEnabled}
                              onCheckedChange={(checked) => setFeeEnabled(checked === true)}
                            />
                            {t("masterData.bankTransactions.allocation.feeToggle")}
                          </label>
                          {feeEnabled && (
                            <div className="flex items-center gap-2">
                              <Input
                                type="number"
                                min={0}
                                step="0.01"
                                dir="ltr"
                                className="w-32"
                                placeholder={t("masterData.bankTransactions.allocation.feeAmount")}
                                value={feeAmountDraft}
                                onChange={(e) => setFeeAmountDraft(e.target.value)}
                              />
                              <AccountPicker
                                value={feeAccount}
                                onChange={setFeeAccount}
                                accountType="EXPENSE"
                                placeholder={t("masterData.bankTransactions.allocation.feeAccount")}
                              />
                            </div>
                          )}
                        </div>
                      )}

                      <div className="flex items-center justify-between rounded-md bg-muted/30 p-3 text-caption">
                        <span dir="ltr">
                          {t("masterData.bankTransactions.allocation.allocated")}:{" "}
                          {formatMoney(String(totalAllocated), transaction.currency?.code)}
                        </span>
                        <span
                          dir="ltr"
                          className={remainingUnallocated < 0 ? "text-destructive font-medium" : ""}
                        >
                          {t("masterData.bankTransactions.allocation.remaining")}:{" "}
                          {formatMoney(String(remainingUnallocated), transaction.currency?.code)}
                        </span>
                      </div>
                      <EnterpriseButton
                        type="button"
                        onClick={confirmAllocations}
                        disabled={
                          allocating ||
                          selectedInvoiceIds.size === 0 ||
                          totalAllocated <= 0 ||
                          remainingUnallocated < 0
                        }
                      >
                        {t("masterData.bankTransactions.allocation.confirm")}
                      </EnterpriseButton>
                    </div>
                  )}
                </>
              )}

              {isIncoming ? (
                <div className="flex gap-2">
                  <EnterpriseButton
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => setManualPicker("STORE_ORDER")}
                  >
                    <Search className="size-3.5" />
                    {t("masterData.bankTransactions.manual.searchStoreOrder")}
                  </EnterpriseButton>
                  <EnterpriseButton
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => setManualPicker("SALES_INVOICE")}
                  >
                    <Search className="size-3.5" />
                    {t("masterData.bankTransactions.manual.searchSalesInvoice")}
                  </EnterpriseButton>
                </div>
              ) : (
                <EnterpriseButton
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => setManualPicker("PURCHASE_INVOICE")}
                >
                  <Search className="size-3.5" />
                  {t("masterData.bankTransactions.manual.searchPurchaseInvoice")}
                </EnterpriseButton>
              )}

              <div className="flex flex-col gap-2 rounded-md border border-border p-3">
                <div className="flex items-center justify-between">
                  <span className="text-caption font-medium text-muted-foreground">
                    {t("masterData.bankTransactions.transfer.title")}
                  </span>
                  <EnterpriseButton
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={findTransferCandidates}
                    disabled={loadingTransfer}
                  >
                    <Search className="size-3.5" />
                    {t("masterData.bankTransactions.transfer.find")}
                  </EnterpriseButton>
                </div>
                {loadingTransfer && (
                  <p className="text-caption text-muted-foreground">{t("common.loading")}</p>
                )}
                {transferCandidates && transferCandidates.length === 0 && (
                  <p className="text-caption text-muted-foreground">
                    {t("masterData.bankTransactions.transfer.noCandidates")}
                  </p>
                )}
                {transferCandidates && transferCandidates.length > 0 && (
                  <div className="flex flex-col gap-2">
                    {transferCandidates.map((candidate) => (
                      <div
                        key={candidate.id}
                        className="flex items-center justify-between gap-3 rounded-md border border-border p-2"
                      >
                        <div className="flex flex-col gap-0.5">
                          <span className="font-medium" dir="ltr">
                            {candidate.label}
                          </span>
                          <span className="text-caption text-muted-foreground">
                            {candidate.reasons.join(" · ")}
                            {candidate.cashSourceName ? ` · ${candidate.cashSourceName}` : ""}
                          </span>
                        </div>
                        <EnterpriseButton
                          type="button"
                          size="sm"
                          onClick={() => confirmTransfer(candidate.id)}
                          disabled={confirmingTransferId === candidate.id}
                        >
                          {t("masterData.bankTransactions.transfer.confirm")}
                        </EnterpriseButton>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {manualPicker === "STORE_ORDER" && (
                <EntitySearchPicker
                  label={t("masterData.bankTransactions.manual.searchStoreOrder")}
                  placeholder={t("masterData.bankTransactions.manual.searchPlaceholder")}
                  search={async (query) => {
                    const result = await storeOrdersService.list({ search: query, pageSize: 20 });
                    return (result.items as StoreOrderRow[]).map((o) => ({
                      id: o.id,
                      label: o.internalOrderId,
                      searchText: `${o.externalOrderId ?? ""} ${o.id}`,
                    }));
                  }}
                  cacheKey="bank-reconcile:store-orders"
                  onSelect={(id) =>
                    confirmCandidate({
                      kind: "STORE_ORDER",
                      id,
                      label: id,
                      amount: 0,
                      score: 0,
                      reasons: [],
                    })
                  }
                />
              )}
              {manualPicker === "SALES_INVOICE" && (
                <EntitySearchPicker
                  label={t("masterData.bankTransactions.manual.searchSalesInvoice")}
                  placeholder={t("masterData.bankTransactions.manual.searchPlaceholder")}
                  search={async (query) => {
                    const result = await salesInvoicesService.list({ search: query, pageSize: 20 });
                    return (result.items as SalesInvoiceRow[]).map((i) => ({
                      id: i.id,
                      label: i.invoiceNumber,
                    }));
                  }}
                  cacheKey="bank-reconcile:sales-invoices"
                  onSelect={(id) =>
                    confirmCandidate({
                      kind: "SALES_INVOICE",
                      id,
                      label: id,
                      amount: 0,
                      score: 0,
                      reasons: [],
                    })
                  }
                />
              )}
              {manualPicker === "PURCHASE_INVOICE" && (
                <EntitySearchPicker
                  label={t("masterData.bankTransactions.manual.searchPurchaseInvoice")}
                  placeholder={t("masterData.bankTransactions.manual.searchPlaceholder")}
                  search={async (query) => {
                    const result = await purchaseInvoicesService.list({
                      search: query,
                      pageSize: 20,
                    });
                    return (result.items as PurchaseInvoiceRow[]).map((i) => ({
                      id: i.id,
                      label: i.invoiceNumber,
                    }));
                  }}
                  cacheKey="bank-reconcile:purchase-invoices"
                  onSelect={(id) =>
                    confirmCandidate({
                      kind: "PURCHASE_INVOICE",
                      id,
                      label: id,
                      amount: 0,
                      score: 0,
                      reasons: [],
                    })
                  }
                />
              )}
            </>
          )}
        </div>
      </EnterpriseModal>
      <ConfirmationDialog
        open={!!mismatchCandidate}
        onOpenChange={(open) => {
          if (!open) {
            setMismatchCandidate(null);
            setMismatchMode(null);
          }
        }}
        tone="warning"
        title={t("masterData.bankTransactions.methodMismatchTitle")}
        description={t("masterData.bankTransactions.methodMismatchDescription", {
          expected: mismatchCandidate?.expectedPaymentSourceName ?? "—",
          actual: mismatchCandidate?.actualCashSourceName ?? "—",
        })}
        extra={
          <div className="flex flex-col gap-2 px-1">
            <EnterpriseButton
              type="button"
              variant="outline"
              size="sm"
              disabled={busy || mismatchMode === "match"}
              onClick={() => {
                if (!mismatchCandidate) return;
                setMismatchMode("update");
                void confirmCandidate(mismatchCandidate, {
                  acknowledgeMethodMismatch: true,
                  updateExpectedPaymentSource: true,
                });
              }}
            >
              {t("masterData.bankTransactions.methodMismatchUpdateExpected")}
            </EnterpriseButton>
          </div>
        }
        confirmLabel={t("masterData.bankTransactions.methodMismatchMatchAnyway")}
        isConfirming={busy && mismatchMode === "match"}
        onConfirm={() => {
          if (!mismatchCandidate) return;
          setMismatchMode("match");
          void confirmCandidate(mismatchCandidate, {
            acknowledgeMethodMismatch: true,
            updateExpectedPaymentSource: false,
          });
        }}
      />
    </>
  );
}

// ---------------------------------------------------------------------------
// Manual document search (Store Order / Sales Invoice / Purchase Invoice) -
// a labelled `EntityCombobox` whose remote search is deduped through
// `cachedLookup`. It holds the selected object (so the trigger shows the
// document number, never a raw id); picking a row hands its id to the
// caller, which confirms the match straight away.
// ---------------------------------------------------------------------------

type ManualSearchItem = { id: string; label: string; searchText?: string };

function EntitySearchPicker({
  label,
  placeholder,
  cacheKey,
  search,
  onSelect,
}: {
  label: string;
  placeholder: string;
  /** Stable lookup-cache prefix for this search source. */
  cacheKey: string;
  search: (query: string) => Promise<ManualSearchItem[]>;
  onSelect: (id: string) => void;
}) {
  const { t } = useLocale();
  const fieldId = useId();
  const [selected, setSelected] = useState<ManualSearchItem | null>(null);

  return (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor={fieldId}>{label}</Label>
      <EntityCombobox
        id={fieldId}
        value={selected}
        onChange={(item) => {
          setSelected(item);
          if (item) onSelect(item.id);
        }}
        onSearch={(query) => cachedLookup(`${cacheKey}:${query}`, () => search(query))}
        getId={(item) => item.id}
        getTitle={(item) => item.label}
        getSearchText={(item) => item.searchText ?? ""}
        placeholder={placeholder}
        searchPlaceholder={placeholder}
        emptyText={t("masterData.bankTransactions.manual.noResults")}
        noMatchText={t("masterData.bankTransactions.manual.noResults")}
        loadingText={t("common.loading")}
        allowClear
      />
    </div>
  );
}

export default function BankTransactionsPage() {
  return (
    <PermissionGate permission="accounting.bank-transactions.view">
      <CashFlowPageContent />
    </PermissionGate>
  );
}
