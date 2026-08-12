"use client";

import { useCallback, useEffect, useState } from "react";
import { Landmark, RefreshCw } from "lucide-react";
import { PageHeader } from "@/components/shared/page-header";
import { EmptyState } from "@/components/shared/empty-state";
import { EnterpriseModal } from "@/components/shared/enterprise-modal";
import { EnterpriseButton } from "@/components/ui/button";
import { LoadingOverlay } from "@/components/shared/loading-overlay";
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
import { useLocale } from "@/providers/locale-provider";
import { useUserContext } from "@/providers/user-context";
import { toast } from "@/lib/toast";
import { formatDate } from "@/lib/date";
import { ApiError } from "@/services/api-client";
import {
  bankTransactionsService,
  type BankTransactionRow,
  type BankTransactionMatchStatus,
} from "@/services/bank-transactions-service";
import type { MessageKey } from "@/i18n/translate";

const STATUS_TABS: BankTransactionMatchStatus[] = [
  "UNMATCHED",
  "POTENTIAL",
  "MATCHED",
  "DUPLICATE",
];

const STATUS_LABEL_KEY: Record<BankTransactionMatchStatus, MessageKey> = {
  UNMATCHED: "masterData.bankTransactions.status.UNMATCHED",
  POTENTIAL: "masterData.bankTransactions.status.POTENTIAL",
  MATCHED: "masterData.bankTransactions.status.MATCHED",
  DUPLICATE: "masterData.bankTransactions.status.DUPLICATE",
};

const STATUS_TONE: Record<BankTransactionMatchStatus, StatusTone> = {
  UNMATCHED: "neutral",
  POTENTIAL: "warning",
  MATCHED: "success",
  DUPLICATE: "destructive",
};

function formatMoney(value: string | null, currencyCode: string | undefined) {
  if (value === null) return "—";
  const num = Number(value);
  return `${num.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}${currencyCode ? ` ${currencyCode}` : ""}`;
}

function BankTransactionsPageContent() {
  const { t } = useLocale();
  const { hasPermission } = useUserContext();
  const canManage = hasPermission("accounting.bank-transactions.manage");

  const [statusFilter, setStatusFilter] = useState<BankTransactionMatchStatus>("UNMATCHED");
  const [items, setItems] = useState<BankTransactionRow[]>([]);
  const [counts, setCounts] = useState<Record<BankTransactionMatchStatus, number>>({
    UNMATCHED: 0,
    POTENTIAL: 0,
    MATCHED: 0,
    DUPLICATE: 0,
  });
  const [isLoading, setIsLoading] = useState(true);
  const [isRunningMatch, setIsRunningMatch] = useState(false);
  const [reviewTarget, setReviewTarget] = useState<BankTransactionRow | null>(null);
  const [isConfirming, setIsConfirming] = useState(false);

  const load = useCallback(async () => {
    setIsLoading(true);
    try {
      const [list, statusCounts] = await Promise.all([
        bankTransactionsService.list({ matchStatus: statusFilter, pageSize: 100 }),
        bankTransactionsService.statusCounts(),
      ]);
      setItems(list.items);
      setCounts(statusCounts);
    } catch (error) {
      toast.error(error instanceof ApiError ? error.message : "Failed to load bank transactions.");
    } finally {
      setIsLoading(false);
    }
  }, [statusFilter]);

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

  const handleConfirm = async (paymentId: string) => {
    if (!reviewTarget) return;
    setIsConfirming(true);
    try {
      await bankTransactionsService.confirmMatch(reviewTarget.id, paymentId);
      toast.success(t("masterData.bankTransactions.matchConfirmed"));
      setReviewTarget(null);
      await load();
    } catch (error) {
      toast.error(error instanceof ApiError ? error.message : "Failed to confirm match.");
    } finally {
      setIsConfirming(false);
    }
  };

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title={t("masterData.bankTransactions.title")}
        subtitle={t("masterData.bankTransactions.description")}
        actions={
          <div className="flex items-center gap-2">
            <SyncButton sourceType="CASH_FLOW" onSynced={load} />
            <ModuleImportButtons importType="BANK_TRANSACTIONS" onImported={load} />
            {canManage && (
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
        filters={
          <div className="flex flex-wrap gap-2">
            {STATUS_TABS.map((status) => (
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
          </div>
        }
      />

      <div className="relative rounded-xl border shadow-sm">
        {isLoading && <LoadingOverlay />}
        {items.length === 0 && !isLoading ? (
          <EmptyState icon={Landmark} title={t("masterData.bankTransactions.empty")} />
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t("masterData.bankTransactions.fields.date")}</TableHead>
                <TableHead>{t("masterData.bankTransactions.fields.description")}</TableHead>
                <TableHead>{t("masterData.bankTransactions.fields.reference")}</TableHead>
                <TableHead>{t("masterData.bankTransactions.fields.amount")}</TableHead>
                <TableHead>{t("common.status")}</TableHead>
                <TableHead>{t("common.actions")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {items.map((row) => (
                <TableRow key={row.id}>
                  <TableCell>{formatDate(row.transactionDate)}</TableCell>
                  <TableCell className="max-w-64 truncate">{row.description ?? "—"}</TableCell>
                  <TableCell dir="ltr">{row.reference ?? "—"}</TableCell>
                  <TableCell dir="ltr">{formatMoney(row.amount, row.currency?.code)}</TableCell>
                  <TableCell>
                    <StatusBadge
                      label={t(STATUS_LABEL_KEY[row.matchStatus])}
                      tone={STATUS_TONE[row.matchStatus]}
                    />
                  </TableCell>
                  <TableCell>
                    {row.matchStatus === "MATCHED" ? (
                      <span className="text-caption text-muted-foreground">
                        {row.matchedPayment?.paymentNumber}
                      </span>
                    ) : (
                      canManage && (
                        <EnterpriseButton
                          type="button"
                          variant="ghost"
                          size="sm"
                          onClick={() => setReviewTarget(row)}
                        >
                          {t("masterData.bankTransactions.review")}
                        </EnterpriseButton>
                      )
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </div>

      <EnterpriseModal
        open={!!reviewTarget}
        onOpenChange={(open) => !open && setReviewTarget(null)}
        size="md"
        icon={Landmark}
        title={t("masterData.bankTransactions.review")}
        description={
          reviewTarget
            ? `${formatDate(reviewTarget.transactionDate)} — ${formatMoney(reviewTarget.amount, reviewTarget.currency?.code)}`
            : undefined
        }
        footer={(requestClose) => (
          <EnterpriseButton
            type="button"
            variant="ghost"
            onClick={requestClose}
            disabled={isConfirming}
          >
            {t("common.cancel")}
          </EnterpriseButton>
        )}
      >
        {reviewTarget && (
          <div className="flex flex-col gap-3">
            {reviewTarget.description && (
              <p className="text-caption text-muted-foreground">{reviewTarget.description}</p>
            )}
            {!reviewTarget.matchCandidates || reviewTarget.matchCandidates.length === 0 ? (
              <p className="text-caption text-muted-foreground">
                {t("masterData.bankTransactions.noCandidates")}
              </p>
            ) : (
              <div className="flex flex-col gap-2">
                {reviewTarget.matchCandidates.map((candidate) => (
                  <div
                    key={candidate.paymentId}
                    className="flex items-center justify-between gap-3 rounded-md border border-border p-3"
                  >
                    <div className="flex flex-col gap-1">
                      <span className="font-medium" dir="ltr">
                        {candidate.paymentNumber}
                      </span>
                      <span className="text-caption text-muted-foreground">
                        {candidate.reasons.join(" · ")}
                      </span>
                    </div>
                    <EnterpriseButton
                      type="button"
                      size="sm"
                      onClick={() => handleConfirm(candidate.paymentId)}
                      disabled={isConfirming}
                    >
                      {t("masterData.bankTransactions.confirmMatch")}
                    </EnterpriseButton>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </EnterpriseModal>
    </div>
  );
}

export default function BankTransactionsPage() {
  return (
    <PermissionGate permission="accounting.bank-transactions.view">
      <BankTransactionsPageContent />
    </PermissionGate>
  );
}
