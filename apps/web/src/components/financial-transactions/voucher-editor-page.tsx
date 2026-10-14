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
import {
  mergeAllocatedInvoices,
  OpenInvoicesTable,
  type VoucherInvoiceRow,
} from "@/components/financial-transactions/open-invoices-table";
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
import type { DocumentActionConfirmation } from "@/components/documents/document-action-bar";
import { VoucherReview, type VoucherReviewData } from "./voucher-review";
import type {
  FinancialTransactionActivityEntry,
  FinancialTransactionFormPayload,
  FinancialTransactionRow,
  OpenInvoiceRow,
  createFinancialTransactionService,
} from "@/services/financial-transactions-service";
import {
  counterAccountsService,
  internalTransfersService,
  otherPaymentsService,
  otherReceiptsService,
  type CounterAccountOption,
} from "@/services/voucher-services";
import { receivingAccountsService } from "@/services/receiving-accounts-service";
import { paymentSourcesService } from "@/services/payment-sources-service";
import { partnersService, type PartnerPickerRow } from "@/services/partners-service";
import { buildTransactionStatusOptions } from "@/config/financial-transactions/status";
import {
  purposeDefinition,
  purposeFromQuery,
  purposeOfVoucher,
  purposeQueryValue,
  purposesFor,
  type VoucherPurpose,
} from "@/config/financial-transactions/voucher-purpose";
import type { DocumentPrintPayload } from "@/types/print-engine";
import type { PrintBuilderOptions } from "@/config/documents/commercial-print";
import { usePrintEngine } from "@/hooks/use-print-engine";
import { useCurrencies } from "@/hooks/use-reference-data";
import { usePrintCompany } from "@/components/print/print-brand";
import { useUserContext } from "@/providers/user-context";
import { useLocale } from "@/providers/locale-provider";
import { useBreadcrumbLabel } from "@/providers/breadcrumb-provider";
import { reportApiError, reportSuccess } from "@/lib/toast";
import { useIdempotencyKey } from "@/hooks/use-idempotency-key";
import { notifyDataChanged } from "@/hooks/use-data-changed";
import { formatMoney } from "@/lib/money";
import type { MessageKey } from "@/i18n/translate";
import {
  isOtherCurrency,
  planPayAllRemaining,
  resolveSettlementCurrency,
} from "@/components/financial-transactions/settlement-currency";
import {
  unappliedPostingConfirmation,
  useVoucherAmount,
} from "@/components/financial-transactions/use-voucher-amount";

type VoucherService = ReturnType<typeof createFinancialTransactionService>;

/**
 * What differs between the receipt card (customer side) and the payment card
 * (supplier side) — everything else is this one page (R22 §3: the two editor
 * pages were 650 / 638-line near-duplicates).
 */
export interface VoucherPageConfig {
  direction: "IN" | "OUT";
  partyRole: "CUSTOMER" | "SUPPLIER";
  relatedKind: "CUSTOMER_RECEIPT" | "SUPPLIER_PAYMENT";
  /** List / editor route: `/sales/payments` or `/purchasing/payments`. */
  basePath: string;
  /** `sales.receipts` / `purchasing.payments` — create / edit / confirm / cancel. */
  permissionPrefix: string;
  titleKey: MessageKey;
  partyLabelKey: MessageKey;
  addNewKey: MessageKey;
  docCodePreview: string;
  /** The invoice-settlement voucher service (customer receipts / supplier payments). */
  service: VoucherService;
  invoiceHref: (invoiceId: string) => string;
  /** A saved allocation as a line of this card (sales vs purchase invoice fields). */
  allocationToLine: (
    allocation: FinancialTransactionRow["allocations"][number],
  ) => AllocationGridLine;
  buildPrint: (row: FinancialTransactionRow, options: PrintBuilderOptions) => DocumentPrintPayload;
}

/** OTHER_* / INTERNAL_TRANSFER are authorised like a manual journal entry (D4 — no new grant). */
const MANUAL_ENTRY_PERMISSION = "journal-entries.create";

let nextLineId = 1;
const round2 = (value: number) => Math.round(value * 100) / 100;

/**
 * R22 §3 — the ONE receipt / payment voucher card (config-driven): purpose →
 * party or account → amount / currency / method / account / date → the
 * invoices it settles (settlement only) → review → Confirm. The purpose picks
 * the voucher type on the same FinancialTransaction API (settlement /
 * advance → receipts|payments, other → other-receipts|other-payments,
 * transfer → transfers); a direct expense opens the existing Expenses editor.
 * A confirmed voucher's allocation changes are single server operations
 * (W1: one atomic PATCH per changed line; on failure the card reloads the
 * server's lines), and every successful operation signals `settlement` so
 * invoices, statements and profiles refresh.
 */
export function VoucherEditorPage({
  id,
  config,
}: {
  id: string | null;
  config: VoucherPageConfig;
}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { t } = useLocale();
  const { printDocument } = usePrintEngine();
  const printCompany = usePrintCompany();
  const { user, hasPermission } = useUserContext();
  /** One key per opened form — a double submit returns the first document (R13 B2). */
  const { key: idempotencyKey } = useIdempotencyKey();
  const { direction, allocationToLine, service: settlementService, invoiceHref } = config;
  const permission = (action: "create" | "edit" | "confirm" | "cancel") =>
    `${config.permissionPrefix}.${action}`;

  const queryPurpose = purposeFromQuery(searchParams.get("purpose"));
  const currencies = useCurrencies();
  const [purpose, setPurpose] = useState<VoucherPurpose>(queryPurpose ?? "SETTLE_INVOICES");
  const definition = purposeDefinition(direction, purpose);
  const serviceFor = useCallback(
    (forPurpose: VoucherPurpose): VoucherService => {
      if (forPurpose === "OTHER")
        return direction === "IN" ? otherReceiptsService : otherPaymentsService;
      if (forPurpose === "TRANSFER") return internalTransfersService;
      return settlementService;
    },
    [settlementService, direction],
  );
  const service = serviceFor(purpose);

  const [voucher, setVoucher] = useState<FinancialTransactionRow | null>(null);
  const [isLoading, setIsLoading] = useState(!!id);
  const [isSaving, setIsSaving] = useState(false);
  const [isTransitioning, setIsTransitioning] = useState(false);
  const [activity, setActivity] = useState<FinancialTransactionActivityEntry[] | null | undefined>(
    undefined,
  );
  const [deleteTarget, setDeleteTarget] = useState(false);

  const [party, setParty] = useState<PartnerPickerRow | null>(null);
  const [transactionDate, setTransactionDate] = useState<Date | null>(new Date());
  const { amount, setAmount, proposeAmount, syncToAllocations } = useVoucherAmount();
  const [referenceNumber, setReferenceNumber] = useState("");
  const [notes, setNotes] = useState("");
  const [paymentSourceId, setPaymentSourceId] = useState<string | null>(null);
  const [receivingAccountId, setReceivingAccountId] = useState<string | null>(null);
  const [allocations, setAllocations] = useState<AllocationGridLine[]>([]);
  const [currencyId, setCurrencyId] = useState<string | null>(null);
  const [counterAccountId, setCounterAccountId] = useState<string | null>(null);
  const [targetReceivingAccountId, setTargetReceivingAccountId] = useState<string | null>(null);

  const [openInvoices, setOpenInvoices] = useState<OpenInvoiceRow[]>([]);
  const [isLoadingOpenInvoices, setIsLoadingOpenInvoices] = useState(false);
  const appliedInvoicePrefillRef = useRef(false);
  /** Synchronous double-click guard for Confirm on a new voucher. */
  const confirmingRef = useRef(false);

  // Names for the review (cached lookups — the editor reads the same lists).
  const [accountNames, setAccountNames] = useState<Map<string, string>>(new Map());
  const [methodNames, setMethodNames] = useState<Map<string, string>>(new Map());
  const [counterAccounts, setCounterAccounts] = useState<CounterAccountOption[]>([]);
  useEffect(() => {
    receivingAccountsService
      .list()
      .then((rows) => setAccountNames(new Map(rows.map((row) => [row.id, row.name]))))
      .catch(() => {});
    paymentSourcesService
      .list()
      .then((rows) => setMethodNames(new Map(rows.map((row) => [row.id, row.name]))))
      .catch(() => {});
  }, []);
  useEffect(() => {
    if (purpose !== "OTHER") return;
    counterAccountsService
      .list(direction)
      .then(setCounterAccounts)
      .catch(() => setCounterAccounts([]));
  }, [purpose, direction]);

  const applyVoucher = useCallback(
    (data: FinancialTransactionRow) => {
      setVoucher(data);
      setParty(data.partner ?? null);
      setTransactionDate(new Date(data.transactionDate));
      setAmount(Number(data.amount));
      setReferenceNumber(data.referenceNumber ?? "");
      setNotes(data.notes ?? "");
      setPaymentSourceId(data.paymentSourceId);
      setReceivingAccountId(data.receivingAccountId);
      setCurrencyId(data.currencyId);
      setCounterAccountId(data.counterAccountId ?? null);
      setTargetReceivingAccountId(data.targetReceivingAccountId ?? null);
      setAllocations(data.allocations.map(allocationToLine));
      if (data.type) setPurpose(purposeOfVoucher(data));
    },
    [
      setAmount,
      allocationToLine,
      setVoucher,
      setParty,
      setTransactionDate,
      setReferenceNumber,
      setNotes,
      setPaymentSourceId,
      setReceivingAccountId,
      setCurrencyId,
      setCounterAccountId,
      setTargetReceivingAccountId,
      setAllocations,
      setPurpose,
    ],
  );

  /** The route's type (`?purpose=other|transfer`) decides which service reads the voucher. */
  const reload = useCallback(
    async (voucherId: string) => {
      applyVoucher(await serviceFor(queryPurpose ?? "SETTLE_INVOICES").get(voucherId));
    },
    [applyVoucher, serviceFor, queryPurpose],
  );

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
        await reload(id);
      } catch (error) {
        reportApiError(error, "errors.loadFailed");
      } finally {
        setIsLoading(false);
      }
    };
    void load();
  }, [id, reload]);

  /** Deep-link prefill ("New Receipt" / "Receive Payment" on a profile or invoice) — a brand-new voucher only. */
  useEffect(() => {
    if (id || party) return;
    const prefillPartyId = searchParams.get("partnerId");
    if (!prefillPartyId) return;
    // Picker-scoped lookup (not `.get`, which needs `partners.view`) so a
    // Finance user following the deep link still gets the party prefilled.
    partnersService
      .catalog({ ids: [prefillPartyId], pageSize: 1, role: [config.partyRole] })
      .then((result) => setParty(result.items[0] ?? null))
      .catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, searchParams]);

  const refreshActivity = useCallback(
    (voucherId: string) => {
      service
        .activities(voucherId)
        .then(setActivity)
        .catch(() => setActivity([]));
    },
    [service],
  );

  useEffect(() => {
    if (id) refreshActivity(id);
  }, [id, refreshActivity]);

  const loadOpenInvoices = useCallback(
    (partyId: string) => {
      setIsLoadingOpenInvoices(true);
      settlementService
        .openInvoices(partyId)
        .then(setOpenInvoices)
        .catch(() => setOpenInvoices([]))
        .finally(() => setIsLoadingOpenInvoices(false));
    },
    [settlementService],
  );

  useEffect(() => {
    if (!party || !definition.needsParty) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setOpenInvoices([]);
      return;
    }
    loadOpenInvoices(party.id);
  }, [party, definition.needsParty, loadOpenInvoices]);

  const isConfirmed = voucher?.status === "CONFIRMED";
  const isDraft = !voucher || voucher.status === "DRAFT";
  /**
   * A confirmed receipt / payment can still settle invoices (an advance
   * allocated later): its allocation table shows whenever there is anything
   * to allocate or already allocated.
   */
  const settlesInvoices =
    definition.needsAllocation ||
    (isConfirmed && definition.needsParty && (allocations.length > 0 || openInvoices.length > 0));
  const shownPurpose: VoucherPurpose =
    settlesInvoices && definition.needsParty ? "SETTLE_INVOICES" : purpose;

  const allocatedTotal = allocations.reduce((sum, line) => sum + line.allocatedAmount, 0);
  const unallocatedAmount = Math.max(amount - allocatedTotal, 0);
  /** R20 — the voucher settles invoices of one currency: the saved one, else its first invoice's. */
  const settlement = resolveSettlementCurrency(voucher, allocations, openInvoices);
  const chosenCurrencyCode = currencyId
    ? (currencies.find((currency) => currency.id === currencyId)?.code ??
      (voucher?.currencyId === currencyId ? (voucher.currency?.code ?? null) : null))
    : null;
  // Settlement: the invoices' currency; otherwise the chosen one (none = the base currency, shown by the editor).
  const currencyCode = settlesInvoices
    ? (settlement?.currencyCode ?? openInvoices[0]?.currencyCode ?? null)
    : chosenCurrencyCode;

  /**
   * Inline validation (design §8): after a failed Save/Confirm the messages
   * sit under their fields and update live as the user fixes them — entered
   * data is never cleared. Posting also needs to know where the money
   * went/came from, checked before any request so Confirm never half-succeeds.
   */
  const [validationMode, setValidationMode] = useState<"save" | "post" | null>(null);
  const errorKeys = (forPosting: boolean) =>
    financialTransactionErrorKeys({
      hasParty: party !== null,
      needsParty: definition.needsParty,
      amount,
      allocatedTotal: settlesInvoices ? allocatedTotal : 0,
      receivingAccountId,
      forPosting: forPosting || definition.needsTargetAccount,
      needsCounterAccount: definition.needsCounterAccount,
      counterAccountId,
      needsTargetAccount: definition.needsTargetAccount,
      targetReceivingAccountId,
    });

  const buildPayload = (): FinancialTransactionFormPayload => {
    const base: FinancialTransactionFormPayload = {
      transactionDate: transactionDate ? transactionDate.toISOString() : undefined,
      receivingAccountId: receivingAccountId ?? undefined,
      amount,
      referenceNumber: referenceNumber || undefined,
      notes: notes || undefined,
    };
    if (purpose === "OTHER") {
      return {
        ...base,
        paymentSourceId: paymentSourceId ?? undefined,
        currencyId: currencyId ?? undefined,
        counterAccountId: counterAccountId ?? undefined,
      };
    }
    if (purpose === "TRANSFER") {
      return {
        ...base,
        currencyId: currencyId ?? undefined,
        targetReceivingAccountId: targetReceivingAccountId ?? undefined,
      };
    }
    return {
      ...base,
      partnerId: party?.id,
      paymentSourceId: paymentSourceId ?? undefined,
      currencyId: settlesInvoices ? settlement?.currencyId : (currencyId ?? undefined),
      allocations: settlesInvoices
        ? allocations.map((line) => ({
            invoiceId: line.invoiceId,
            allocatedAmount: line.allocatedAmount,
          }))
        : [],
    };
  };

  const routeFor = (voucherId: string) => {
    const query = purposeQueryValue(purpose);
    return `${config.basePath}/${voucherId}${query ? `?purpose=${query}` : ""}`;
  };

  const handleSave = async () => {
    if (errorKeys(false)) {
      setValidationMode("save");
      return;
    }
    setValidationMode(null);
    setIsSaving(true);
    try {
      if (id) {
        const updated = await service.update(id, buildPayload());
        applyVoucher(updated);
        reportSuccess(t("common.saved"));
      } else {
        const created = await service.create({ ...buildPayload(), idempotencyKey });
        reportSuccess(t("common.saved"));
        router.replace(routeFor(created.id));
      }
    } catch (error) {
      reportApiError(error, "errors.generic");
    } finally {
      setIsSaving(false);
    }
  };

  const runTransition = async (
    action: (voucherId: string) => Promise<FinancialTransactionRow>,
    successKey: MessageKey,
  ) => {
    if (!id) return;
    setIsTransitioning(true);
    try {
      const updated = await action(id);
      applyVoucher(updated);
      reportSuccess(t(successKey));
      refreshActivity(id);
      notifyDataChanged("settlement");
    } catch (error) {
      reportApiError(error, "errors.generic");
    } finally {
      setIsTransitioning(false);
    }
  };

  /** "Confirm" on a saved draft: the existing confirm call. */
  const handleConfirmExisting = async () => {
    if (errorKeys(true)) {
      setValidationMode("post");
      return;
    }
    setValidationMode(null);
    await runTransition(
      (voucherId) => service.confirm(voucherId),
      "financialTransactions.toasts.confirmed",
    );
  };

  /** "Confirm" on a brand-new voucher: create + confirm + post atomically (one request, idempotent). */
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
      const confirmed = await service.createConfirmed({ ...buildPayload(), idempotencyKey });
      reportSuccess(t("financialTransactions.toasts.confirmed"));
      notifyDataChanged("settlement");
      router.replace(routeFor(confirmed.id));
    } catch (error) {
      reportApiError(error, "errors.generic");
    } finally {
      confirmingRef.current = false;
      setIsTransitioning(false);
    }
  };

  /**
   * While Draft, allocation edits are local (persisted on Save). Once
   * Confirmed every change is a single server operation per line — removed →
   * Unallocate, changed → the atomic PATCH (W1: never Unallocate + Allocate),
   * added → Allocate — and after any failure the card shows exactly what the
   * server holds.
   */
  const handleAllocationsChange = async (nextLines: AllocationGridLine[]) => {
    if (!voucher || voucher.status === "DRAFT") {
      setAllocations(nextLines);
      syncToAllocations(nextLines);
      return;
    }
    const nextById = new Map(nextLines.map((line) => [line.id, line]));
    const prevIds = new Set(allocations.map((line) => line.id));
    setIsTransitioning(true);
    try {
      for (const prev of allocations) {
        const next = nextById.get(prev.id);
        if (!next || next.allocatedAmount <= 0) {
          await settlementService.unallocate(voucher.id, prev.id);
        } else if (next.allocatedAmount !== prev.allocatedAmount) {
          await settlementService.updateAllocation(voucher.id, prev.id, {
            allocatedAmount: next.allocatedAmount,
          });
        }
      }
      for (const next of nextLines) {
        if (!prevIds.has(next.id) && next.allocatedAmount > 0) {
          await settlementService.allocate(voucher.id, {
            invoiceId: next.invoiceId,
            allocatedAmount: next.allocatedAmount,
          });
        }
      }
      applyVoucher(await settlementService.get(voucher.id));
      reportSuccess(t("financialTransactions.toasts.allocated"));
    } catch (error) {
      reportApiError(error, "errors.generic");
      // Whatever part was refused, show the server's lines — never a stale local copy.
      try {
        applyVoucher(await settlementService.get(voucher.id));
      } catch {
        // The error above is already reported.
      }
    } finally {
      notifyDataChanged("settlement");
      if (party) loadOpenInvoices(party.id);
      setIsTransitioning(false);
    }
  };

  /** The inline «this voucher» amount of one invoice (0 removes the line). */
  const handleInlineAllocation = (invoice: VoucherInvoiceRow, value: number) => {
    if (isOtherCurrency(invoice, settlement)) return;
    const existing = allocations.find((line) => line.invoiceId === invoice.invoiceId);
    let nextLines: AllocationGridLine[];
    if (existing) {
      nextLines =
        value > 0
          ? allocations.map((line) =>
              line.id === existing.id ? { ...line, allocatedAmount: value } : line,
            )
          : allocations.filter((line) => line.id !== existing.id);
    } else if (value > 0) {
      nextLines = [
        ...allocations,
        {
          id: `row-${nextLineId++}`,
          invoiceId: invoice.invoiceId,
          invoiceNumber: invoice.invoiceNumber,
          invoiceHref: invoiceHref(invoice.invoiceId),
          remainingBalance: invoice.remainingBalance,
          allocatedAmount: value,
        },
      ];
    } else {
      return;
    }
    // Nothing typed yet: the amount follows what is allocated (one field less to fill).
    if (isDraft && amount === 0)
      proposeAmount(round2(nextLines.reduce((s, l) => s + l.allocatedAmount, 0)));
    void handleAllocationsChange(nextLines);
  };

  /** Deep-link prefill for "Receive / Record Payment" on an invoice — proposes its open balance, allocated in full. */
  useEffect(() => {
    if (id || appliedInvoicePrefillRef.current) return;
    const prefillInvoiceId = searchParams.get("invoiceId");
    if (!prefillInvoiceId || openInvoices.length === 0) return;
    const invoice = openInvoices.find((row) => row.invoiceId === prefillInvoiceId);
    if (!invoice) return;
    appliedInvoicePrefillRef.current = true;
    proposeAmount(invoice.remainingBalance);
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setPurpose("SETTLE_INVOICES");
    setAllocations([
      {
        id: `row-${nextLineId++}`,
        invoiceId: invoice.invoiceId,
        invoiceNumber: invoice.invoiceNumber,
        invoiceHref: invoiceHref(invoice.invoiceId),
        remainingBalance: invoice.remainingBalance,
        allocatedAmount: invoice.remainingBalance,
      },
    ]);
  }, [id, searchParams, openInvoices, proposeAmount, invoiceHref]);

  const handlePayAllRemaining = () => {
    // No amount typed yet: settle every open invoice (oldest first) and propose their total.
    const unset = isDraft && amount === 0;
    const cap = unset ? Number.POSITIVE_INFINITY : unallocatedAmount;
    const planned = planPayAllRemaining(openInvoices, allocations, cap, settlement);
    const nextLines = allocations.map((line) =>
      planned.has(line.invoiceId)
        ? { ...line, allocatedAmount: planned.get(line.invoiceId) ?? line.allocatedAmount }
        : line,
    );
    for (const invoice of openInvoices) {
      const planAmount = planned.get(invoice.invoiceId);
      if (!planAmount || nextLines.some((line) => line.invoiceId === invoice.invoiceId)) continue;
      nextLines.push({
        id: `row-${nextLineId++}`,
        invoiceId: invoice.invoiceId,
        invoiceNumber: invoice.invoiceNumber,
        invoiceHref: invoiceHref(invoice.invoiceId),
        remainingBalance: invoice.remainingBalance,
        allocatedAmount: planAmount,
      });
    }
    if (unset) proposeAmount(round2(nextLines.reduce((s, l) => s + l.allocatedAmount, 0)));
    void handleAllocationsChange(nextLines);
    reportSuccess(t("financialTransactions.toasts.payAllRemainingApplied"));
  };

  const handlePurposeChange = (next: VoucherPurpose) => {
    const target = purposeDefinition(direction, next);
    if (target.href) {
      router.push(target.href);
      return;
    }
    setPurpose(next);
    setValidationMode(null);
    if (!target.needsAllocation && isDraft) {
      setAllocations([]);
      syncToAllocations([]);
    }
  };

  /** Hard delete — Draft only, server-enforced (nothing to reverse: a Draft never posted). */
  const handleDelete = async () => {
    if (!id) return;
    setIsTransitioning(true);
    try {
      await service.remove(id);
      reportSuccess(t("financialTransactions.toasts.deleted"));
      router.push(config.basePath);
    } catch (error) {
      reportApiError(error, "errors.generic");
    } finally {
      setIsTransitioning(false);
    }
  };

  const handlePrint = () => {
    if (!voucher) return;
    printDocument(
      config.buildPrint(voucher, {
        companyName: printCompany.name,
        companyLogoUrl: printCompany.logoUrl ?? null,
        printedByName: user?.fullName ?? null,
        t,
      }),
    );
  };

  /** R22 §3 — review before posting: where the money goes, invoices settled, the unapplied rest. */
  const reviewConfirmation = (): DocumentActionConfirmation | undefined => {
    if (errorKeys(true)) return undefined; // invalid: Confirm shows the inline errors instead
    const applied = settlesInvoices ? allocatedTotal : 0;
    const unappliedWarning = definition.needsParty
      ? unappliedPostingConfirmation(
          {
            amount,
            allocatedTotal: applied,
            hasOpenInvoices: openInvoices.length > 0,
            direction,
          },
          t,
          (value) => formatMoney(value),
        )
      : undefined;
    const counter = counterAccounts.find((account) => account.id === counterAccountId);
    const data: VoucherReviewData = {
      direction,
      purpose: shownPurpose,
      amount,
      currencyCode,
      partyName: definition.needsParty ? (party?.name ?? null) : null,
      accountName: receivingAccountId ? (accountNames.get(receivingAccountId) ?? null) : null,
      methodName:
        paymentSourceId && purpose !== "TRANSFER"
          ? (methodNames.get(paymentSourceId) ?? null)
          : null,
      counterAccountName: counter ? `${counter.code} · ${counter.name}` : null,
      targetAccountName: targetReceivingAccountId
        ? (accountNames.get(targetReceivingAccountId) ?? null)
        : null,
      invoices: settlesInvoices
        ? allocations.map((line) => ({
            invoiceNumber: line.invoiceNumber,
            amount: line.allocatedAmount,
          }))
        : [],
      unapplied: definition.needsParty ? round2(amount - applied) : 0,
      hasOpenInvoices: openInvoices.length > 0,
      date: transactionDate,
    };
    const shownAmount = formatMoney(amount, currencyCode ?? undefined);
    return {
      title: unappliedWarning ? t("vouchers.review.titleUnapplied") : t("vouchers.review.title"),
      description: unappliedWarning?.description,
      tone: unappliedWarning ? "warning" : "default",
      size: "lg",
      extra: <VoucherReview data={data} />,
      confirmLabel: t("vouchers.review.confirm", { amount: shownAmount }),
    };
  };

  const canConfirm = hasPermission(permission("confirm"));
  const canCancel = hasPermission(permission("cancel"));
  const canEdit = isDraft;
  const canUseManualEntryTypes = hasPermission(MANUAL_ENTRY_PERMISSION);

  /** New: every purpose (manual-entry types only for those who may post one); saved: its type's purposes. */
  const purposeOptions = useMemo(() => {
    const all = purposesFor(direction).filter(
      (entry) =>
        (entry.purpose !== "OTHER" && entry.purpose !== "TRANSFER") || canUseManualEntryTypes,
    );
    if (!voucher) return all;
    const savedPurpose = purposeOfVoucher(voucher);
    if (savedPurpose === "OTHER" || savedPurpose === "TRANSFER") {
      return all.filter((entry) => entry.purpose === savedPurpose);
    }
    return all.filter(
      (entry) => entry.purpose === "SETTLE_INVOICES" || entry.purpose === "ADVANCE",
    );
  }, [direction, voucher, canUseManualEntryTypes]);

  const title =
    purpose === "OTHER"
      ? t(direction === "IN" ? "vouchers.titles.OTHER_IN" : "vouchers.titles.OTHER_OUT")
      : purpose === "TRANSFER"
        ? t("vouchers.titles.TRANSFER")
        : t(config.titleKey);

  const editorConfig: FinancialTransactionEditorConfig = {
    title,
    partyLabel: t(config.partyLabelKey),
    transactionType: definition.transactionType ?? config.relatedKind,
    direction,
    docCodePreview: config.docCodePreview,
    permissions: {
      create: permission("create"),
      edit: permission("edit"),
      confirm: permission("confirm"),
      cancel: permission("cancel"),
    },
    purposes: purposeOptions.length > 0 ? purposeOptions : purposesFor(direction),
    statusOptions: buildTransactionStatusOptions(t),
    toolbarExtra: (
      <EnterpriseButton
        type="button"
        size="sm"
        className="gap-1.5"
        disabled={isSaving || isTransitioning || !isDraft}
        onClick={handleSave}
      >
        <Save className="size-3.5" />
        {t("common.save")}
      </EnterpriseButton>
    ),
    // The confirm handler reads `confirmingRef` only when clicked, never during render.
    // eslint-disable-next-line react-hooks/refs
    workflowActions: [
      {
        key: "confirm" as const,
        label: t("financialTransactions.actions.confirm"),
        icon: CheckCircle2,
        variant: "default" as const,
        visibleForStatuses: ["DRAFT" as const],
        confirm: reviewConfirmation(),
        onAction: () => (id ? handleConfirmExisting() : handleConfirmNew()),
      },
      {
        key: "cancel" as const,
        label: t("financialTransactions.actions.cancel"),
        icon: Ban,
        variant: "destructive" as const,
        visibleForStatuses: ["CONFIRMED" as const],
        confirm: {
          title: t("financialTransactions.confirmCancelTitle"),
          description: t("financialTransactions.confirmCancelDescription"),
          confirmLabel: t("financialTransactions.actions.cancel"),
          tone: "destructive" as const,
        },
        onAction: async () => {
          await runTransition(
            (voucherId) => service.cancel(voucherId),
            "financialTransactions.toasts.cancelled",
          );
        },
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
      if (action.key === "confirm" && !canConfirm) return false;
      if (action.key === "cancel" && !canCancel) return false;
      if (action.key === "delete" && (!voucher || !canEdit)) return false;
      if (action.key === "print" && !voucher) return false;
      return true;
    }),
  };

  const state: FinancialTransactionEditorState = {
    document: voucher,
    documentNumber: voucher?.transactionNumber ?? null,
    status: voucher?.status ?? "DRAFT",
    transactionDate,
    amount,
    referenceNumber,
    notes,
    paymentSourceId,
    receivingAccountId,
    allocations,
    purpose: shownPurpose,
    currencyId,
    counterAccountId,
    targetReceivingAccountId,
  };

  const handlers: FinancialTransactionEditorHandlers = {
    onTransactionDateChange: setTransactionDate,
    onAmountChange: setAmount,
    onReferenceNumberChange: setReferenceNumber,
    onNotesChange: setNotes,
    onPaymentSourceChange: setPaymentSourceId,
    onReceivingAccountChange: setReceivingAccountId,
    onAllocationsChange: handleAllocationsChange,
    onPurposeChange: handlePurposeChange,
    onCurrencyChange: setCurrencyId,
    onCounterAccountChange: setCounterAccountId,
    onTargetAccountChange: setTargetReceivingAccountId,
  };

  useBreadcrumbLabel(voucher?.transactionNumber ?? t(config.addNewKey));

  const tableRows = mergeAllocatedInvoices(
    openInvoices,
    allocations.map((line) => ({
      invoiceId: line.invoiceId,
      invoiceNumber: line.invoiceNumber,
      invoiceHref: line.invoiceHref,
      allocatedAmount: line.allocatedAmount,
      grandTotal: line.grandTotal,
      locked: line.locked,
    })),
    invoiceHref,
  );

  const allocationSection =
    settlesInvoices && party ? (
      <div className="flex min-w-0 flex-col gap-2">
        {!isLoadingOpenInvoices && tableRows.length === 0 ? (
          <p className="text-caption text-muted-foreground">
            {t("vouchers.allocation.noOpenInvoices")}
          </p>
        ) : (
          <OpenInvoicesTable
            invoices={tableRows}
            isLoading={isLoadingOpenInvoices}
            disabled={(!canEdit && !isConfirmed) || isTransitioning}
            onAllocationChange={handleInlineAllocation}
            commitOnBlur={isConfirmed}
            onPayAllRemaining={openInvoices.length > 0 ? handlePayAllRemaining : undefined}
            allocations={allocations}
            confirmedVoucher={isConfirmed}
            currency={settlement}
          />
        )}
      </div>
    ) : null;

  return (
    <EditorWorkspace>
      <RelatedRecordsPanel kind={config.relatedKind} id={id} refreshKey={voucher?.updatedAt} />

      <FinancialTransactionEditor
        config={editorConfig}
        state={state}
        handlers={handlers}
        currencyCode={currencyCode}
        activity={activity}
        isLoading={isLoading}
        disabled={!canEdit || isSaving}
        isBusy={isSaving || isTransitioning}
        purposeLocked={!!voucher && !isDraft}
        fieldErrors={
          validationMode ? translateFieldErrors(errorKeys(validationMode === "post"), t) : undefined
        }
        renderPartyPicker={({ disabled, id: fieldId }) => (
          <PartnerPicker
            id={fieldId}
            role={config.partyRole}
            value={party}
            onChange={setParty}
            disabled={disabled}
          />
        )}
        allocationSection={allocationSection}
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
