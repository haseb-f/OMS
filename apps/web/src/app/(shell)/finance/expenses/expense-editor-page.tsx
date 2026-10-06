"use client";

import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { CheckCircle2, Printer, Save, Trash2, Undo2 } from "lucide-react";
import { EnterpriseButton } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ConfirmationDialog } from "@/components/shared/confirmation-dialog";
import { EditorWorkspace } from "@/components/shared/detail-workspace";
import { RelatedRecordsPanel } from "@/components/shared/related-records-panel";
import { DismissibleAlert } from "@/components/shared/dismissible-alert";
import { StatusBadge } from "@/components/business/status-badge";
import { AccountPicker } from "@/components/business/account-picker";
import { PartnerPicker } from "@/components/business/partner-picker";
import { CostCenterPicker } from "@/components/business/cost-center-picker";
import { ProjectPicker } from "@/components/business/project-picker";
import { CurrencyPicker } from "@/components/business/currency-picker";
import { JournalTraceCell } from "@/components/accounting/journal-trace-cell";
import { FinancialTransactionEditor } from "@/components/financial-transactions/financial-transaction-editor";
import type {
  FinancialTransactionEditorConfig,
  FinancialTransactionEditorHandlers,
  FinancialTransactionEditorState,
} from "@/components/financial-transactions/financial-transaction-editor.types";
import { translateFieldErrors } from "@/components/financial-transactions/financial-transaction-validation";
import {
  expenseVouchersService,
  type FinancialTransactionActivityEntry,
  type FinancialTransactionRow,
  type OpenInvoiceRow,
} from "@/services/expense-vouchers-service";
import { exchangeRatesService, type ExchangeRateCheck } from "@/services/fx-service";
import type { PartnerPickerRow } from "@/services/partners-service";
import type { ChartOfAccountRow, CostCenterRow, ProjectRow } from "@/config/master-data/entities";
import { buildTransactionStatusOptions } from "@/config/financial-transactions/status";
import {
  EXPENSES_ROUTE,
  EXPENSE_POSTING_LABEL_KEY,
  EXPENSE_POSTING_TONE,
  buildExpenseVoucherPayload,
  expensePostingState,
  expenseVoucherErrorKeys,
  expenseVoucherHref,
  openInvoicesSummary,
  payInvoiceHref,
  type ExpenseVoucherFormState,
} from "@/config/finance/expense-voucher";
import { buildExpenseVoucherPrintPayload } from "@/config/finance/expense-voucher-print";
import { useCurrencies } from "@/hooks/use-reference-data";
import { useIdempotencyKey } from "@/hooks/use-idempotency-key";
import { usePrintEngine } from "@/hooks/use-print-engine";
import { usePrintCompany } from "@/components/print/print-brand";
import { useUserContext } from "@/providers/user-context";
import { useLocale } from "@/providers/locale-provider";
import { useBreadcrumbLabel } from "@/providers/breadcrumb-provider";
import { reportApiError, reportDestructiveDone, reportSuccess } from "@/lib/toast";
import { formatDate, toISODate } from "@/lib/date";
import { formatMoney } from "@/lib/money";

const PERMISSIONS = {
  create: "accounting.expense-payments.create",
  edit: "accounting.expense-payments.edit",
  confirm: "accounting.expense-payments.confirm",
  cancel: "accounting.expense-payments.cancel",
} as const;

type Link3 = { id: string; code: string; name: string };

const asAccount = (account: Link3 | null | undefined): ChartOfAccountRow | null =>
  account ? ({ ...account, parentAccount: null } as unknown as ChartOfAccountRow) : null;
const asCostCenter = (row: Link3 | null | undefined): CostCenterRow | null =>
  row ? { ...row, description: null, deletedAt: null } : null;
const asProject = (row: Link3 | null | undefined): ProjectRow | null =>
  row ? { ...row, description: null, deletedAt: null } : null;

/**
 * Expense voucher editor (R13 owner decision 2) — the shared
 * FinancialTransactionEditor without allocations: Draft (Save, nothing
 * posted) → Confirm & post (Posting Engine: Dr expense account / Cr paid
 * from) → Reverse (reversal entry). A supplier counterparty with open
 * purchase invoices is offered "Pay invoice instead" — the expense voucher
 * itself never settles an invoice.
 */
export function ExpenseEditorPage({ id }: { id: string | null }) {
  const router = useRouter();
  const { t } = useLocale();
  const fieldId = useId();
  const { printDocument } = usePrintEngine();
  const printCompany = usePrintCompany();
  const { user, hasPermission } = useUserContext();
  const currencies = useCurrencies();
  /** One key per opened form — a double submit returns the first document (R13 B2). */
  const { key: idempotencyKey } = useIdempotencyKey();

  const [voucher, setVoucher] = useState<FinancialTransactionRow | null>(null);
  const [isLoading, setIsLoading] = useState(!!id);
  const [isSaving, setIsSaving] = useState(false);
  const [isTransitioning, setIsTransitioning] = useState(false);
  const [activity, setActivity] = useState<FinancialTransactionActivityEntry[] | null | undefined>(
    undefined,
  );
  const [deleteTarget, setDeleteTarget] = useState(false);

  const [expenseAccount, setExpenseAccount] = useState<ChartOfAccountRow | null>(null);
  const [transactionDate, setTransactionDate] = useState<Date | null>(new Date());
  const [description, setDescription] = useState("");
  const [amount, setAmount] = useState(0);
  const [currencyId, setCurrencyId] = useState<string | null>(null);
  const [paymentSourceId, setPaymentSourceId] = useState<string | null>(null);
  const [receivingAccountId, setReceivingAccountId] = useState<string | null>(null);
  const [counterparty, setCounterparty] = useState<PartnerPickerRow | null>(null);
  const [costCenter, setCostCenter] = useState<CostCenterRow | null>(null);
  const [project, setProject] = useState<ProjectRow | null>(null);
  const [referenceNumber, setReferenceNumber] = useState("");
  const [notes, setNotes] = useState("");

  const [openInvoices, setOpenInvoices] = useState<OpenInvoiceRow[]>([]);
  const [rateCheck, setRateCheck] = useState<ExchangeRateCheck | null>(null);
  /** Synchronous double-click guard for Confirm & post on a new voucher. */
  const confirmingRef = useRef(false);

  const applyVoucher = useCallback((data: FinancialTransactionRow) => {
    setVoucher(data);
    setExpenseAccount(asAccount(data.expenseAccount));
    setTransactionDate(new Date(data.transactionDate));
    setDescription(data.description ?? "");
    setAmount(Number(data.amount));
    setCurrencyId(data.currencyId);
    setPaymentSourceId(data.paymentSourceId);
    setReceivingAccountId(data.receivingAccountId);
    setCounterparty((data.partner as PartnerPickerRow | null | undefined) ?? null);
    setCostCenter(asCostCenter(data.costCenter));
    setProject(asProject(data.project));
    setReferenceNumber(data.referenceNumber ?? "");
    setNotes(data.notes ?? "");
  }, []);

  useEffect(() => {
    if (!id) {
      setIsLoading(false);
      setActivity([]);
      return;
    }
    const load = async () => {
      setIsLoading(true);
      try {
        applyVoucher(await expenseVouchersService.get(id));
      } catch (error) {
        reportApiError(error, "errors.loadFailed");
      } finally {
        setIsLoading(false);
      }
    };
    void load();
  }, [id, applyVoucher]);

  const refreshActivity = useCallback((voucherId: string) => {
    expenseVouchersService
      .activities(voucherId)
      .then(setActivity)
      .catch(() => setActivity([]));
  }, []);

  useEffect(() => {
    if (id) refreshActivity(id);
  }, [id, refreshActivity]);

  const status = voucher?.status ?? "DRAFT";
  const isDraft = status === "DRAFT";

  // Open purchase invoices of the counterparty — only while the expense can still change, and only for a
  // user who may see supplier payments (the API answers 403 otherwise; the panel then simply stays hidden).
  const canViewOpenInvoices = hasPermission("purchasing.payments.view");
  useEffect(() => {
    if (!counterparty || !isDraft || !canViewOpenInvoices) {
      setOpenInvoices([]);
      return;
    }
    let cancelled = false;
    expenseVouchersService
      .openInvoices(counterparty.id)
      .then((rows) => {
        if (!cancelled) setOpenInvoices(rows);
      })
      .catch(() => {
        if (!cancelled) setOpenInvoices([]);
      });
    return () => {
      cancelled = true;
    };
  }, [counterparty, isDraft, canViewOpenInvoices]);

  // Exchange rate for a foreign currency: the rate on the expense date (a
  // posted voucher shows its frozen rate; the check supplies the base code).
  const rateDate = transactionDate ? toISODate(transactionDate) : undefined;
  useEffect(() => {
    if (!currencyId) {
      setRateCheck(null);
      return;
    }
    let cancelled = false;
    exchangeRatesService
      .check(currencyId, rateDate)
      .then((check) => {
        if (!cancelled) setRateCheck(check);
      })
      .catch(() => {
        if (!cancelled) setRateCheck(null);
      });
    return () => {
      cancelled = true;
    };
  }, [currencyId, rateDate]);

  const currencyCode = useMemo(
    () => currencies.find((currency) => currency.id === currencyId)?.code ?? null,
    [currencies, currencyId],
  );

  const formState: ExpenseVoucherFormState = {
    transactionDate,
    expenseAccountId: expenseAccount?.id ?? null,
    description,
    amount,
    currencyId,
    receivingAccountId,
    paymentSourceId,
    partnerId: counterparty?.id ?? null,
    costCenterId: costCenter?.id ?? null,
    projectId: project?.id ?? null,
    referenceNumber,
    notes,
  };

  /** Inline validation (design §8): messages stay under their fields and update live; data is never cleared. */
  const [validationMode, setValidationMode] = useState<"save" | "post" | null>(null);

  const handleSave = async () => {
    if (expenseVoucherErrorKeys(formState, false)) {
      setValidationMode("save");
      return;
    }
    setValidationMode(null);
    setIsSaving(true);
    try {
      if (id) {
        applyVoucher(
          await expenseVouchersService.update(id, buildExpenseVoucherPayload(formState, "update")),
        );
        reportSuccess(t("expenseVouchers.toasts.saved"));
        refreshActivity(id);
      } else {
        const created = await expenseVouchersService.create({
          ...buildExpenseVoucherPayload(formState, "create"),
          idempotencyKey,
        });
        reportSuccess(t("expenseVouchers.toasts.saved"));
        router.replace(expenseVoucherHref(created.id));
      }
    } catch (error) {
      reportApiError(error, "errors.generic");
    } finally {
      setIsSaving(false);
    }
  };

  /**
   * Confirm & post. A new form creates + posts atomically with its idempotency
   * key (a double click returns the first voucher); a saved draft saves the
   * edits first, then confirms — the server posts exactly once.
   */
  const handleConfirmPost = async () => {
    if (expenseVoucherErrorKeys(formState, true)) {
      setValidationMode("post");
      return;
    }
    setValidationMode(null);
    if (confirmingRef.current) return;
    confirmingRef.current = true;
    setIsTransitioning(true);
    try {
      if (id) {
        await expenseVouchersService.update(id, buildExpenseVoucherPayload(formState, "update"));
        const posted = await expenseVouchersService.confirm(id);
        applyVoucher(posted);
        refreshActivity(id);
        reportSuccess(t("expenseVouchers.toasts.posted", { number: posted.transactionNumber }));
      } else {
        const posted = await expenseVouchersService.createConfirmed({
          ...buildExpenseVoucherPayload(formState, "create"),
          idempotencyKey,
        });
        reportSuccess(t("expenseVouchers.toasts.posted", { number: posted.transactionNumber }));
        router.replace(expenseVoucherHref(posted.id));
      }
    } catch (error) {
      reportApiError(error, "errors.generic");
    } finally {
      confirmingRef.current = false;
      setIsTransitioning(false);
    }
  };

  const handleReverse = async () => {
    if (!id) return;
    setIsTransitioning(true);
    try {
      const reversed = await expenseVouchersService.cancel(id);
      applyVoucher(reversed);
      refreshActivity(id);
      reportDestructiveDone(
        t("expenseVouchers.toasts.reversed", { number: reversed.transactionNumber }),
      );
    } catch (error) {
      reportApiError(error, "errors.cancelFailed");
    } finally {
      setIsTransitioning(false);
    }
  };

  /** Hard delete — Draft only (server-enforced); a draft never posted anything. */
  const handleDelete = async () => {
    if (!id) return;
    setIsTransitioning(true);
    try {
      await expenseVouchersService.remove(id);
      reportSuccess(t("financialTransactions.toasts.deleted"));
      router.push(EXPENSES_ROUTE);
    } catch (error) {
      reportApiError(error, "errors.generic");
    } finally {
      setIsTransitioning(false);
    }
  };

  const handlePrint = () => {
    if (!voucher) return;
    printDocument(
      buildExpenseVoucherPrintPayload(voucher, {
        companyName: printCompany.name,
        companyLogoUrl: printCompany.logoUrl ?? null,
        printedByName: user?.fullName ?? null,
        t,
      }),
    );
  };

  const canConfirm = hasPermission(PERMISSIONS.confirm);
  const canCancel = hasPermission(PERMISSIONS.cancel);
  const canEdit = isDraft && hasPermission(id ? PERMISSIONS.edit : PERMISSIONS.create);
  const isBusy = isSaving || isTransitioning;

  const config: FinancialTransactionEditorConfig = {
    title: t("expenseVouchers.editorTitle"),
    partyLabel: t("expenseVouchers.fields.expenseAccount"),
    transactionType: "EXPENSE_PAYMENT",
    direction: "OUT",
    docCodePreview: "EP",
    permissions: { ...PERMISSIONS, edit: id ? PERMISSIONS.edit : PERMISSIONS.create },
    statusOptions: buildTransactionStatusOptions(t),
    fieldLabels: {
      transactionDate: t("expenseVouchers.fields.date"),
      paymentSource: t("expenseVouchers.fields.paymentMethod"),
      receivingAccount: t("expenseVouchers.fields.paidFrom"),
    },
    toolbarExtra: isDraft ? (
      <EnterpriseButton
        type="button"
        size="sm"
        className="gap-1.5"
        disabled={isBusy || !canEdit}
        onClick={handleSave}
      >
        <Save className="size-3.5" />
        {t("common.save")}
      </EnterpriseButton>
    ) : undefined,
    workflowActions: [
      {
        key: "confirm" as const,
        label: t("expenseVouchers.actions.confirmPost"),
        icon: CheckCircle2,
        variant: "default" as const,
        visibleForStatuses: ["DRAFT" as const],
        confirm: {
          title: t("expenseVouchers.confirmDialog.title"),
          description: t("expenseVouchers.confirmDialog.description"),
          confirmLabel: t("expenseVouchers.actions.confirmPost"),
        },
        onAction: () => handleConfirmPost(),
      },
      {
        key: "cancel" as const,
        label: t("expenseVouchers.actions.reverse"),
        icon: Undo2,
        variant: "destructive" as const,
        visibleForStatuses: ["CONFIRMED" as const],
        confirm: {
          title: t("expenseVouchers.reverseDialog.title"),
          description: t("expenseVouchers.reverseDialog.description"),
          confirmLabel: t("expenseVouchers.actions.reverse"),
          tone: "destructive" as const,
        },
        onAction: () => handleReverse(),
      },
      {
        key: "delete" as const,
        label: t("common.delete"),
        icon: Trash2,
        variant: "destructive" as const,
        visibleForStatuses: ["DRAFT" as const],
        onAction: () => setDeleteTarget(true),
      },
      {
        key: "print" as const,
        label: t("table.print"),
        icon: Printer,
        variant: "outline" as const,
        onAction: () => handlePrint(),
      },
    ].filter((action) => {
      if (action.key === "confirm") return canConfirm;
      if (action.key === "cancel") return canCancel;
      if (action.key === "delete") return !!voucher && canEdit;
      if (action.key === "print") return !!voucher;
      return true;
    }),
  };

  const state: FinancialTransactionEditorState = {
    document: voucher,
    documentNumber: voucher?.transactionNumber ?? null,
    status,
    transactionDate,
    amount,
    referenceNumber,
    notes,
    paymentSourceId,
    receivingAccountId,
    allocations: [],
  };

  const handlers: FinancialTransactionEditorHandlers = {
    onTransactionDateChange: setTransactionDate,
    onAmountChange: setAmount,
    onReferenceNumberChange: setReferenceNumber,
    onNotesChange: setNotes,
    onPaymentSourceChange: setPaymentSourceId,
    onReceivingAccountChange: setReceivingAccountId,
    // An expense voucher never allocates (server-enforced).
    onAllocationsChange: () => undefined,
  };

  const errorKeys = validationMode
    ? expenseVoucherErrorKeys(formState, validationMode === "post")
    : null;

  useBreadcrumbLabel(voucher?.transactionNumber ?? t("expenseVouchers.addNew"));

  const postingState = expensePostingState(status);
  const frozenRate = voucher?.exchangeRate ? Number(voucher.exchangeRate) : null;
  const rateLine = (() => {
    if (!currencyId) return t("expenseVouchers.rate.base");
    if (!isDraft) {
      return frozenRate && currencyCode
        ? t("expenseVouchers.rate.value", {
            code: currencyCode,
            rate: frozenRate,
            base: rateCheck?.toCurrencyCode ?? "",
            date: formatDate(voucher?.confirmedAt ?? voucher?.transactionDate ?? ""),
          })
        : null;
    }
    if (!rateCheck || !rateCheck.required) return null;
    if (rateCheck.available && rateCheck.rate !== null) {
      return t("expenseVouchers.rate.value", {
        code: rateCheck.fromCurrencyCode ?? currencyCode ?? "",
        rate: rateCheck.rate,
        base: rateCheck.toCurrencyCode ?? "",
        date: formatDate(rateCheck.effectiveDate ?? rateCheck.asOf),
      });
    }
    return t("expenseVouchers.rate.missing", { code: currencyCode ?? "" });
  })();
  const rateMissing = isDraft && !!rateCheck?.required && !rateCheck.available;

  const invoiceSummary = openInvoicesSummary(openInvoices);
  const canPayInvoice = hasPermission("purchasing.payments.create");

  const label = (suffix: string, text: string) => (
    <label htmlFor={`${fieldId}-${suffix}`} className="text-caption text-muted-foreground">
      {text}
    </label>
  );

  const extraFields = (
    <>
      <div className="flex min-w-0 flex-col gap-1 sm:col-span-2">
        {label("description", t("expenseVouchers.fields.description"))}
        <Input
          id={`${fieldId}-description`}
          dir="auto"
          value={description}
          maxLength={500}
          disabled={!canEdit}
          placeholder={t("expenseVouchers.fields.descriptionPlaceholder")}
          onChange={(event) => setDescription(event.target.value)}
        />
      </div>
      <div className="flex min-w-0 flex-col gap-1">
        {label("currency", t("expenseVouchers.fields.currency"))}
        <CurrencyPicker
          id={`${fieldId}-currency`}
          valueKey="id"
          value={currencyId ?? ""}
          disabled={!canEdit}
          allowClear
          placeholder={t("sales.editor.header.baseCurrency")}
          onValueChange={(value) => setCurrencyId(value || null)}
        />
        {rateLine ? (
          <p
            className={
              rateMissing
                ? "text-caption text-warning-foreground"
                : "text-caption text-muted-foreground"
            }
          >
            {rateLine}
          </p>
        ) : null}
      </div>
      <div className="flex min-w-0 flex-col gap-1">
        {label("counterparty", t("expenseVouchers.fields.counterparty"))}
        <PartnerPicker
          id={`${fieldId}-counterparty`}
          role="SUPPLIER"
          value={counterparty}
          onChange={setCounterparty}
          onClear={() => setCounterparty(null)}
          disabled={!canEdit}
        />
      </div>
      <div className="flex min-w-0 flex-col gap-1">
        {label("costCenter", t("expenseVouchers.fields.costCenter"))}
        <CostCenterPicker
          id={`${fieldId}-costCenter`}
          value={costCenter}
          onChange={setCostCenter}
          disabled={!canEdit}
        />
      </div>
      <div className="flex min-w-0 flex-col gap-1">
        {label("project", t("expenseVouchers.fields.project"))}
        <ProjectPicker
          id={`${fieldId}-project`}
          value={project}
          onChange={setProject}
          disabled={!canEdit}
        />
      </div>
      {voucher ? (
        <div className="flex min-w-0 flex-col gap-1">
          <span className="text-caption text-muted-foreground">
            {t("expenseVouchers.fields.posting")}
          </span>
          <div className="flex min-h-8 flex-wrap items-center gap-2">
            <StatusBadge
              label={t(EXPENSE_POSTING_LABEL_KEY[postingState])}
              tone={EXPENSE_POSTING_TONE[postingState]}
            />
            {postingState !== "notPosted" ? (
              // Remount per state: after a reversal the posted entry is the reversal.
              <JournalTraceCell
                key={status}
                sourceType="EXPENSE_PAYMENT"
                sourceId={voucher.id}
                expected
              />
            ) : null}
          </div>
        </div>
      ) : null}
    </>
  );

  const afterMainForm =
    counterparty && invoiceSummary.count > 0 && isDraft ? (
      <DismissibleAlert
        tone="warning"
        title={t("expenseVouchers.invoices.title", {
          supplier: counterparty.name,
          count: invoiceSummary.count,
          amount: formatMoney(invoiceSummary.remaining),
        })}
      >
        <p className="text-caption">{t("expenseVouchers.invoices.hint")}</p>
        <ul className="mt-2 flex flex-col gap-1">
          {openInvoices.map((invoice) => (
            <li
              key={invoice.invoiceId}
              className="flex flex-wrap items-center justify-between gap-2 text-caption"
            >
              <span className="flex flex-wrap items-center gap-2">
                <bdi className="font-medium">{invoice.invoiceNumber}</bdi>
                <span className="text-muted-foreground">
                  {t("expenseVouchers.invoices.remaining", {
                    amount: formatMoney(invoice.remainingBalance),
                  })}
                </span>
              </span>
              {canPayInvoice ? (
                <EnterpriseButton asChild size="sm" variant="outline">
                  <Link href={payInvoiceHref(counterparty.id, invoice.invoiceId)}>
                    {t("expenseVouchers.invoices.payInstead")}
                  </Link>
                </EnterpriseButton>
              ) : null}
            </li>
          ))}
        </ul>
      </DismissibleAlert>
    ) : null;

  return (
    <EditorWorkspace>
      <RelatedRecordsPanel kind="EXPENSE_PAYMENT" id={id} refreshKey={voucher?.status} />

      <FinancialTransactionEditor
        config={config}
        state={state}
        handlers={handlers}
        activity={activity}
        isLoading={isLoading}
        disabled={!canEdit || isSaving}
        isBusy={isBusy}
        currencyCode={currencyCode}
        showAllocations={false}
        extraFields={extraFields}
        afterMainForm={afterMainForm}
        fieldErrors={errorKeys ? translateFieldErrors(errorKeys, t) : undefined}
        renderPartyPicker={({ disabled, id }) => (
          <AccountPicker
            id={id}
            accountType="EXPENSE"
            postingOnly
            value={expenseAccount}
            onChange={setExpenseAccount}
            disabled={disabled}
            placeholder={t("expenseVouchers.fields.expenseAccount")}
          />
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
