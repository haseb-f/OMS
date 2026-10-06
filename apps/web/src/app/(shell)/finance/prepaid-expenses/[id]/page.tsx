"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useParams } from "next/navigation";
import { CheckCheck, FileText, Play, PlayCircle, Undo2 } from "lucide-react";
import {
  DetailField,
  DetailFieldGrid,
  DetailSection,
  DetailSummaryBar,
  DetailWorkspace,
} from "@/components/shared/detail-workspace";
import { HeaderActions } from "@/components/shared/header-actions";
import { RelatedDocuments, type RelatedDocumentGroup } from "@/components/shared/related-documents";
import { ConfirmationDialog } from "@/components/shared/confirmation-dialog";
import { EmptyState } from "@/components/shared/empty-state";
import { MoneyValue } from "@/components/shared/money-value";
import { StatusBadge } from "@/components/business/status-badge";
import { PartnerPicker } from "@/components/business/partner-picker";
import { SegmentedRadioGroup } from "@/components/documents/segmented-radio-group";
import { EnterpriseDatePicker } from "@/components/shared/date-picker";
import { SearchableSelect } from "@/components/shared/searchable-select";
import type { PartnerPickerRow } from "@/services/partners-service";
import {
  receivingAccountsService,
  type ReceivingAccountOption,
} from "@/services/receiving-accounts-service";
import { PermissionGate } from "@/components/shared/permission-gate";
import { AccountingScheduleTable } from "@/components/accounting/schedule-table";
import {
  prepaidExpensesService,
  type PrepaidExpenseDetail,
} from "@/services/prepaid-expenses-service";
import { useProcessDueSchedules } from "@/hooks/use-process-due-schedules";
import { useBreadcrumbLabel } from "@/providers/breadcrumb-provider";
import { useLocale } from "@/providers/locale-provider";
import { useUserContext } from "@/providers/user-context";
import { reportApiError, toast } from "@/lib/toast";
import { formatDate } from "@/lib/date";
import { formatMoney } from "@/lib/money";
import { prepaidStatusTone } from "@/config/finance/schedule-status";
import type { MessageKey } from "@/i18n/translate";

type Dialog = "activate" | "process" | "cancel" | "recognizeRemaining" | null;

/** R13b (O-3) — where a cancelled prepayment's unrecognized balance goes. */
type RefundTo = "SUPPLIER_CREDIT" | "CASH";

function toIsoDate(date: Date | null): string | null {
  if (!date) return null;
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function PrepaidExpenseDetailContent() {
  const params = useParams<{ id: string }>();
  const { t } = useLocale();
  const { hasPermission } = useUserContext();
  const canEdit = hasPermission("prepaid-expenses.edit");

  const [prepaid, setPrepaid] = useState<PrepaidExpenseDetail | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [dialog, setDialog] = useState<Dialog>(null);
  const [busy, setBusy] = useState(false);
  const [actionDate, setActionDate] = useState<Date | null>(new Date());
  const [refundTo, setRefundTo] = useState<RefundTo>("SUPPLIER_CREDIT");
  const [refundSupplier, setRefundSupplier] = useState<PartnerPickerRow | null>(null);
  const [refundAccountId, setRefundAccountId] = useState("");
  const [receivingAccounts, setReceivingAccounts] = useState<ReceivingAccountOption[]>([]);

  useBreadcrumbLabel(prepaid?.prepaidNumber ?? null);

  const load = useCallback(async () => {
    try {
      setPrepaid(await prepaidExpensesService.detail(params.id));
    } catch {
      setPrepaid(null);
    } finally {
      setIsLoading(false);
    }
  }, [params.id]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  const processDue = useProcessDueSchedules("prepaid", load);

  const activate = async () => {
    if (!prepaid) return;
    setBusy(true);
    try {
      await prepaidExpensesService.activate(prepaid.id);
      toast.success(t("accounting.prepaid.toasts.activated"));
      setDialog(null);
      await load();
    } catch (error) {
      reportApiError(error, "errors.generic");
    } finally {
      setBusy(false);
    }
  };

  const openClose = (kind: "cancel" | "recognizeRemaining") => {
    if (!prepaid) return;
    setActionDate(new Date());
    // Smart default: a prepayment paid from a receiving account is refunded there.
    setRefundTo(prepaid.receivingAccountId ? "CASH" : "SUPPLIER_CREDIT");
    setRefundAccountId(prepaid.receivingAccountId ?? "");
    setRefundSupplier(null);
    setDialog(kind);
    if (kind === "cancel") {
      receivingAccountsService
        .list()
        .then(setReceivingAccounts)
        .catch(() => setReceivingAccounts([]));
    }
  };

  const closeEarly = async () => {
    if (!prepaid) return;
    const date = toIsoDate(actionDate);
    if (!date) return;
    setBusy(true);
    try {
      if (dialog === "cancel") {
        await prepaidExpensesService.cancelWithRefund(prepaid.id, {
          date,
          ...(refundTo === "CASH"
            ? { receivingAccountId: refundAccountId }
            : { partnerId: refundSupplier?.id }),
        });
        toast.success(t("assetSchedules.toasts.cancelled"));
      } else {
        await prepaidExpensesService.recognizeRemaining(prepaid.id, { date });
        toast.success(t("assetSchedules.toasts.recognizedRemaining"));
      }
      setDialog(null);
      await load();
    } catch (error) {
      reportApiError(error, "errors.generic");
    } finally {
      setBusy(false);
    }
  };

  const relatedGroups = useMemo<RelatedDocumentGroup[]>(() => {
    if (!prepaid) return [];
    const groups: RelatedDocumentGroup[] = [];
    if (prepaid.purchaseInvoice) {
      groups.push({
        labelKey: "assetSchedules.links.sourceInvoice",
        links: [
          {
            id: prepaid.purchaseInvoice.id,
            number: prepaid.purchaseInvoice.invoiceNumber,
            href: `/purchasing/purchase-invoices/${prepaid.purchaseInvoice.id}`,
            kind: "PURCHASE_INVOICE",
            status: prepaid.purchaseInvoice.status,
          },
        ],
      });
    }
    const { deferral } = prepaid.journalEntries;
    groups.push({
      labelKey: "assetSchedules.links.deferralEntry",
      links: deferral
        ? [
            {
              id: deferral.id,
              number: deferral.entryNumber,
              href: `/finance/journal-entries/${deferral.id}`,
              kind: "JOURNAL_ENTRY",
            },
          ]
        : [],
      emptyLabel:
        prepaid.status !== "DRAFT" ? t("accounting.journalEntries.missingJournal") : undefined,
    });
    if (prepaid.purchaseReturn) {
      groups.push({
        labelKey: "assetSchedules.links.purchaseReturn",
        links: [
          {
            id: prepaid.purchaseReturn.id,
            number: prepaid.purchaseReturn.returnNumber,
            href: `/purchasing/purchase-returns/${prepaid.purchaseReturn.id}`,
            kind: "PURCHASE_RETURN",
            status: prepaid.purchaseReturn.status,
          },
        ],
      });
    }
    const { refund, acceleration } = prepaid.journalEntries;
    for (const [labelKey, entry] of [
      ["assetSchedules.links.refundEntry", refund],
      ["assetSchedules.links.accelerationEntry", acceleration],
    ] as const) {
      if (!entry) continue;
      groups.push({
        labelKey,
        links: [
          {
            id: entry.id,
            number: entry.entryNumber,
            href: `/finance/journal-entries/${entry.id}`,
            kind: "JOURNAL_ENTRY",
          },
        ],
      });
    }
    return groups;
  }, [prepaid, t]);

  if (isLoading) {
    return <p className="text-caption text-muted-foreground">{t("common.loading")}</p>;
  }
  if (!prepaid) {
    return <EmptyState icon={FileText} title={t("common.noResults")} />;
  }

  const { summary } = prepaid;
  const currency = prepaid.currency?.code ?? null;
  const sourceLine = prepaid.purchaseInvoiceItem;
  const isActive = prepaid.status === "ACTIVE";
  const remainingLabel = formatMoney(summary.remainingAmount, currency);

  return (
    <DetailWorkspace
      title={prepaid.name}
      reference={prepaid.prepaidNumber}
      copyValue={prepaid.prepaidNumber}
      meta={[
        `${formatDate(prepaid.startDate)} → ${formatDate(prepaid.endDate)}`,
        prepaid.partner?.name,
      ]
        .filter(Boolean)
        .join(" · ")}
      status={
        <StatusBadge
          label={t(`accounting.lifecycleStatus.${prepaid.status}` as MessageKey)}
          tone={prepaidStatusTone[prepaid.status]}
        />
      }
      width="wide"
      actions={
        <HeaderActions
          primary={
            prepaid.status === "DRAFT"
              ? {
                  key: "activate",
                  label: t("accounting.prepaid.activate"),
                  icon: Play,
                  hidden: !canEdit,
                  onSelect: () => setDialog("activate"),
                }
              : prepaid.status === "ACTIVE"
                ? {
                    key: "process-due",
                    label: t("accounting.prepaid.recognize"),
                    icon: PlayCircle,
                    hidden: !canEdit,
                    loading: processDue.busy,
                    onSelect: () => setDialog("process"),
                  }
                : undefined
          }
          secondary={[
            {
              key: "recognize-remaining",
              label: t("assetSchedules.actions.recognizeRemaining"),
              icon: CheckCheck,
              hidden: !canEdit || !isActive,
              onSelect: () => openClose("recognizeRemaining"),
            },
          ]}
          destructive={[
            {
              key: "cancel-refund",
              label: t("assetSchedules.actions.cancelWithRefund"),
              icon: Undo2,
              hidden: !canEdit || !isActive,
              onSelect: () => openClose("cancel"),
            },
          ]}
        />
      }
    >
      <RelatedDocuments groups={relatedGroups} />
      {prepaid.closureType && prepaid.closedOn ? (
        <p className="rounded-md border border-border bg-muted/30 px-3 py-2 text-caption text-muted-foreground">
          {t("assetSchedules.dialogs.closedNotice", {
            closure: t(`assetSchedules.closureTypes.${prepaid.closureType}`),
            date: formatDate(prepaid.closedOn),
          })}
        </p>
      ) : null}

      <DetailSummaryBar>
        <DetailField
          label={t("masterData.expenses.fields.amount")}
          value={<MoneyValue value={summary.amount} currency={currency} />}
        />
        <DetailField
          label={t("accounting.prepaid.fields.recognizedAmount")}
          value={<MoneyValue value={summary.recognizedAmount} currency={currency} />}
        />
        {summary.refundedAmount > 0 ? (
          <DetailField
            label={t("assetSchedules.fields.refundedAmount")}
            value={<MoneyValue value={summary.refundedAmount} currency={currency} />}
          />
        ) : null}
        <DetailField
          label={t("assetSchedules.fields.remainingAmount")}
          value={<MoneyValue value={summary.remainingAmount} currency={currency} />}
        />
        <DetailField
          label={t("assetSchedules.fields.periodsPosted")}
          value={
            <span className="num" dir="ltr">
              {summary.postedPeriods} / {prepaid.recognitions.length}
            </span>
          }
        />
        <DetailField
          label={t("assetSchedules.fields.periodsFailed")}
          value={summary.failedPeriods > 0 ? String(summary.failedPeriods) : null}
        />
      </DetailSummaryBar>

      <DetailSection title={t("assetSchedules.sections.parameters")}>
        <DetailFieldGrid columns={3}>
          <DetailField
            label={t("accounting.prepaid.fields.startDate")}
            value={formatDate(prepaid.startDate)}
          />
          <DetailField
            label={t("accounting.prepaid.fields.endDate")}
            value={formatDate(prepaid.endDate)}
          />
          <DetailField
            label={t("accounting.prepaid.fields.totalPeriods")}
            value={String(prepaid.totalPeriods)}
          />
          <DetailField
            label={t("accounting.prepaid.fields.expenseAccount")}
            value={
              prepaid.expenseAccount
                ? `${prepaid.expenseAccount.code} — ${prepaid.expenseAccount.name}`
                : null
            }
          />
          <DetailField
            label={t("accounting.prepaid.fields.receivingAccount")}
            value={prepaid.receivingAccount?.name}
          />
          <DetailField
            label={t("assetSchedules.fields.sourceLine")}
            value={
              sourceLine
                ? [
                    sourceLine.description?.trim() ||
                      sourceLine.product?.displayName ||
                      sourceLine.product?.name,
                    formatMoney(Number(sourceLine.lineTotal) - Number(sourceLine.taxAmount)),
                  ]
                    .filter(Boolean)
                    .join(" · ")
                : null
            }
          />
          {prepaid.refundPartner || prepaid.refundReceivingAccount ? (
            <DetailField
              label={t("assetSchedules.fields.refundTo")}
              value={prepaid.refundPartner?.name ?? prepaid.refundReceivingAccount?.name}
            />
          ) : null}
          <DetailField
            label={t("masterData.fields.notes")}
            value={prepaid.notes}
            className="sm:col-span-2"
          />
        </DetailFieldGrid>
      </DetailSection>

      <DetailSection title={t("assetSchedules.sections.recognitionSchedule")}>
        <AccountingScheduleTable rows={prepaid.recognitions} currency={currency} />
      </DetailSection>

      <ConfirmationDialog
        open={dialog === "activate"}
        onOpenChange={(open) => !open && setDialog(null)}
        title={t("accounting.prepaid.activate")}
        description={t("assetSchedules.dialogs.activateDescription")}
        size="lg"
        extra={
          <div className="max-h-72 overflow-y-auto px-6">
            <AccountingScheduleTable rows={prepaid.recognitions} currency={currency} />
          </div>
        }
        confirmLabel={t("accounting.prepaid.activate")}
        isConfirming={busy}
        onConfirm={() => void activate()}
      />

      <ConfirmationDialog
        open={dialog === "process"}
        onOpenChange={(open) => !open && setDialog(null)}
        title={t("accounting.prepaid.recognize")}
        description={t("assetSchedules.dialogs.processDueDescription")}
        confirmLabel={t("accounting.prepaid.recognize")}
        isConfirming={processDue.busy}
        onConfirm={() => void processDue.run().then(() => setDialog(null))}
      />

      <ConfirmationDialog
        open={dialog === "cancel" || dialog === "recognizeRemaining"}
        onOpenChange={(open) => !open && setDialog(null)}
        title={
          dialog === "cancel"
            ? t("assetSchedules.actions.cancelWithRefund")
            : t("assetSchedules.actions.recognizeRemaining")
        }
        description={
          dialog === "cancel"
            ? t("assetSchedules.dialogs.cancelRefundDescription", { amount: remainingLabel })
            : t("assetSchedules.dialogs.recognizeRemainingDescription", { amount: remainingLabel })
        }
        tone={dialog === "cancel" ? "warning" : undefined}
        extra={
          <div className="grid grid-cols-1 gap-3 px-6 sm:grid-cols-2">
            <label className="flex flex-col gap-1.5">
              <span className="text-caption text-muted-foreground">
                {t("assetSchedules.fields.actionDate")}
              </span>
              <EnterpriseDatePicker value={actionDate} onChange={setActionDate} />
            </label>
            {dialog === "cancel" ? (
              <>
                <div className="flex flex-col gap-1.5 sm:col-span-2">
                  <span className="text-caption text-muted-foreground">
                    {t("assetSchedules.fields.refundTo")}
                  </span>
                  <SegmentedRadioGroup<RefundTo>
                    value={refundTo}
                    onValueChange={setRefundTo}
                    options={(["SUPPLIER_CREDIT", "CASH"] as const).map((value) => ({
                      value,
                      label: t(`assetSchedules.settlement.${value}`),
                    }))}
                    aria-label={t("assetSchedules.fields.refundTo")}
                  />
                </div>
                {refundTo === "CASH" ? (
                  <label className="flex flex-col gap-1.5 sm:col-span-2">
                    <span className="text-caption text-muted-foreground">
                      {t("accounting.prepaid.fields.receivingAccount")}
                    </span>
                    <SearchableSelect
                      value={refundAccountId}
                      onValueChange={setRefundAccountId}
                      options={receivingAccounts.map((account) => ({
                        value: account.id,
                        label: account.name,
                      }))}
                      aria-label={t("accounting.prepaid.fields.receivingAccount")}
                    />
                  </label>
                ) : (
                  <div className="flex flex-col gap-1.5 sm:col-span-2">
                    <span className="text-caption text-muted-foreground">
                      {t("assetSchedules.fields.supplierToCredit")}
                    </span>
                    <PartnerPicker
                      role="SUPPLIER"
                      value={refundSupplier}
                      onChange={setRefundSupplier}
                    />
                  </div>
                )}
              </>
            ) : null}
          </div>
        }
        confirmLabel={
          dialog === "cancel"
            ? t("assetSchedules.actions.cancelWithRefund")
            : t("assetSchedules.actions.recognizeRemaining")
        }
        confirmDisabled={
          !actionDate ||
          (dialog === "cancel" && (refundTo === "CASH" ? !refundAccountId : !refundSupplier))
        }
        isConfirming={busy}
        onConfirm={() => void closeEarly()}
      />
    </DetailWorkspace>
  );
}

export default function PrepaidExpenseDetailPage() {
  return (
    <PermissionGate permission="prepaid-expenses.view">
      <PrepaidExpenseDetailContent />
    </PermissionGate>
  );
}
