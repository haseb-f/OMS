"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useParams } from "next/navigation";
import { FileText, Play, PlayCircle } from "lucide-react";
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

function PrepaidExpenseDetailContent() {
  const params = useParams<{ id: string }>();
  const { t } = useLocale();
  const { hasPermission } = useUserContext();
  const canEdit = hasPermission("prepaid-expenses.edit");

  const [prepaid, setPrepaid] = useState<PrepaidExpenseDetail | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [dialog, setDialog] = useState<"activate" | "process" | null>(null);
  const [busy, setBusy] = useState(false);

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
        />
      }
    >
      <RelatedDocuments groups={relatedGroups} />

      <DetailSummaryBar>
        <DetailField
          label={t("masterData.expenses.fields.amount")}
          value={<MoneyValue value={summary.amount} currency={currency} />}
        />
        <DetailField
          label={t("accounting.prepaid.fields.recognizedAmount")}
          value={<MoneyValue value={summary.recognizedAmount} currency={currency} />}
        />
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
