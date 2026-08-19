"use client";

import { useCallback, useEffect, useState } from "react";
import { Landmark, RefreshCw, Search, Tag, CheckCircle2 } from "lucide-react";
import { PageWorkspace } from "@/components/shared/page-workspace";
import { EmptyState } from "@/components/shared/empty-state";
import { ListSurface, ListToolbar } from "@/components/shared/data-table/list-surface";
import { EnterpriseModal } from "@/components/shared/enterprise-modal";
import { EnterpriseButton } from "@/components/ui/button";
import { LoadingOverlay } from "@/components/shared/loading-overlay";
import { KpiCard } from "@/components/shared/kpi-card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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
import { toast } from "@/lib/toast";
import { formatDate } from "@/lib/date";
import { ApiError } from "@/services/api-client";
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
import { suppliersService, type SupplierRow } from "@/services/suppliers-service";
import { createMasterDataService } from "@/services/master-data-service";
import type { ChartOfAccountRow } from "@/config/master-data/entities";
import type { MessageKey } from "@/i18n/translate";

const chartOfAccountsService = createMasterDataService<ChartOfAccountRow>("/chart-of-accounts");

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
      toast.error(
        error instanceof ApiError ? error.message : "Failed to load Cash Flow transactions.",
      );
    } finally {
      setIsLoading(false);
    }
  }, [direction, statusFilter]);

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
      toast.error(error instanceof ApiError ? error.message : "Failed to run matching.");
    } finally {
      setIsRunningMatch(false);
    }
  };

  return (
    <PageWorkspace
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
                      <span className="text-caption text-muted-foreground" dir="ltr">
                        {row.matchedPayment?.paymentNumber ??
                          row.matchedFinancialTransaction?.transactionNumber}
                      </span>
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
  const [supplierId, setSupplierId] = useState<string | null>(null);
  const [expenseAccountId, setExpenseAccountId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const handleSave = async () => {
    setSaving(true);
    try {
      await bankTransactionsService.classifyOutgoing(transaction.id, {
        outgoingType,
        expenseAccountId: outgoingType === "EXPENSE" ? (expenseAccountId ?? undefined) : undefined,
        partnerSupplierId:
          outgoingType === "SUPPLIER_PAYMENT" ? (supplierId ?? undefined) : undefined,
      });
      toast.success(t("masterData.bankTransactions.classifyDialog.saved"));
      onDone();
    } catch (error) {
      toast.error(error instanceof ApiError ? error.message : "Failed to classify.");
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
            disabled={saving || (outgoingType === "EXPENSE" ? !expenseAccountId : !supplierId)}
          >
            {t("masterData.bankTransactions.classifyDialog.save")}
          </EnterpriseButton>
        </>
      )}
    >
      <div className="flex flex-col gap-4">
        <div className="flex flex-col gap-1.5">
          <Label>{t("masterData.bankTransactions.classifyDialog.outgoingType")}</Label>
          <Select
            value={outgoingType}
            onValueChange={(v) => setOutgoingType(v as CashFlowOutgoingType)}
          >
            <SelectTrigger className="w-full">
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
          <EntitySearchPicker
            label={t("masterData.bankTransactions.classifyDialog.expenseAccount")}
            placeholder={t("masterData.bankTransactions.manual.searchExpenseAccount")}
            search={async (query) => {
              const result = await chartOfAccountsService.list({ search: query, pageSize: 20 });
              return result.items
                .filter((a) => a.accountType === "EXPENSE")
                .map((a) => ({ id: a.id, label: `${a.code} — ${a.name}` }));
            }}
            onSelect={(id) => setExpenseAccountId(id)}
            selectedLabel={expenseAccountId ? expenseAccountId : undefined}
          />
        ) : (
          <EntitySearchPicker
            label={t("masterData.bankTransactions.classifyDialog.supplier")}
            placeholder={t("masterData.bankTransactions.manual.searchSupplier")}
            search={async (query) => {
              const result = await suppliersService.list({ search: query, pageSize: 20 });
              return (result.items as SupplierRow[]).map((s) => ({ id: s.id, label: s.name }));
            }}
            onSelect={(id) => setSupplierId(id)}
            selectedLabel={supplierId ? supplierId : undefined}
          />
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
  const [paymentSourceId, setPaymentSourceId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [manualPicker, setManualPicker] = useState<
    "STORE_ORDER" | "SALES_INVOICE" | "PURCHASE_INVOICE" | null
  >(null);

  useEffect(() => {
    paymentSourcesService
      .list()
      .then(setPaymentSources)
      .catch(() => setPaymentSources([]));
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

  const confirmCandidate = async (candidate: BankTransactionMatchCandidate) => {
    if (!paymentSourceId && candidate.kind !== "PAYMENT") {
      toast.error(t("masterData.bankTransactions.voucher.paymentSource"));
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
      onDone();
    } catch (error) {
      toast.error(error instanceof ApiError ? error.message : "Failed to reconcile.");
    } finally {
      setBusy(false);
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
      toast.error(error instanceof ApiError ? error.message : "Failed to create voucher.");
    } finally {
      setBusy(false);
    }
  };

  const candidateLabelKey: Record<BankTransactionMatchCandidate["kind"], MessageKey> = {
    PAYMENT: "masterData.bankTransactions.candidates.payment",
    STORE_ORDER: "masterData.bankTransactions.candidates.storeOrder",
    SALES_INVOICE: "masterData.bankTransactions.candidates.salesInvoice",
    PURCHASE_INVOICE: "masterData.bankTransactions.candidates.purchaseInvoice",
  };

  return (
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
          <Label>{t("masterData.bankTransactions.voucher.paymentSource")}</Label>
          <Select value={paymentSourceId ?? undefined} onValueChange={setPaymentSourceId}>
            <SelectTrigger className="w-full">
              <SelectValue placeholder={t("common.select")} />
            </SelectTrigger>
            <SelectContent>
              {paymentSources.map((source) => (
                <SelectItem key={source.id} value={source.id}>
                  {source.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
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
              <div className="flex flex-col gap-2">
                {candidates.map((candidate) => (
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

            {manualPicker === "STORE_ORDER" && (
              <EntitySearchPicker
                label={t("masterData.bankTransactions.manual.searchStoreOrder")}
                placeholder={t("masterData.bankTransactions.manual.searchPlaceholder")}
                search={async (query) => {
                  const result = await storeOrdersService.list({ search: query, pageSize: 20 });
                  return (result.items as StoreOrderRow[]).map((o) => ({
                    id: o.id,
                    label: `${o.internalOrderId} (${o.externalOrderId ?? "—"})`,
                  }));
                }}
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
  );
}

// ---------------------------------------------------------------------------
// Generic search-and-select — a lightweight local combobox reused by every
// dialog above instead of five bespoke pickers. Debounced via a plain
// effect keyed on the query string.
// ---------------------------------------------------------------------------

function EntitySearchPicker({
  label,
  placeholder,
  search,
  onSelect,
  selectedLabel,
}: {
  label: string;
  placeholder: string;
  search: (query: string) => Promise<{ id: string; label: string }[]>;
  onSelect: (id: string) => void;
  selectedLabel?: string;
}) {
  const { t } = useLocale();
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<{ id: string; label: string }[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!query.trim()) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setResults([]);
      return;
    }
    setLoading(true);
    const timer = setTimeout(() => {
      search(query)
        .then(setResults)
        .catch(() => setResults([]))
        .finally(() => setLoading(false));
    }, 300);
    return () => clearTimeout(timer);
  }, [query, search]);

  return (
    <div className="flex flex-col gap-1.5">
      <Label>{label}</Label>
      <Input
        dir="ltr"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder={placeholder}
      />
      {selectedLabel && (
        <p className="text-caption text-muted-foreground" dir="ltr">
          {selectedLabel}
        </p>
      )}
      {query.trim() && (
        <div className="flex max-h-40 flex-col gap-1 overflow-y-auto rounded-md border border-border p-1">
          {loading ? (
            <p className="p-2 text-caption text-muted-foreground">{t("common.loading")}</p>
          ) : results.length === 0 ? (
            <p className="p-2 text-caption text-muted-foreground">
              {t("masterData.bankTransactions.manual.noResults")}
            </p>
          ) : (
            results.map((result) => (
              <button
                key={result.id}
                type="button"
                className="rounded-sm px-2 py-1.5 text-start text-caption hover:bg-muted"
                onClick={() => onSelect(result.id)}
                dir="ltr"
              >
                {result.label}
              </button>
            ))
          )}
        </div>
      )}
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
