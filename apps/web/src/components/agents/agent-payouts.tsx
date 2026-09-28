"use client";

import { useCallback, useEffect, useId, useMemo, useState } from "react";
import Link from "next/link";
import { Banknote, Eye, FileText, Plus, Undo2 } from "lucide-react";
import { DetailField, DetailFieldGrid, DetailSection } from "@/components/shared/detail-workspace";
import { EmptyState } from "@/components/shared/empty-state";
import { ErrorState } from "@/components/shared/error-state";
import { ConfirmationDialog } from "@/components/shared/confirmation-dialog";
import { EnterpriseModal } from "@/components/shared/enterprise-modal";
import { CreateOperationFooter } from "@/components/shared/create-operation";
import {
  FormCardField,
  FormCardRow,
  FormCardSection,
  FormCardStack,
} from "@/components/shared/form-card/form-card";
import { SearchableSelect } from "@/components/shared/searchable-select";
import { EnterpriseDatePicker } from "@/components/shared/date-picker";
import { MoneyInput } from "@/components/shared/money-input";
import { MoneyValue } from "@/components/shared/money-value";
import { RowActionsMenu } from "@/components/shared/data-table";
import {
  CompactDetailTable,
  type CompactDetailColumn,
} from "@/components/shared/data-table/compact-detail-table";
import { EnterpriseButton } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { tableIdentityCellClass } from "@/components/ui/table";
import { StatusBadge } from "@/components/business/status-badge";
import { AttachmentPreviewDialog } from "@/components/business/attachment-preview-dialog";
import {
  PaymentReceiptsField,
  stagingIdsOf,
  type ReceiptUploadItem,
} from "@/components/business/payment-receipts-field";
import { newIdempotencyKey } from "@/components/payments/declaration/declaration-logic";
import { payoutAmountError } from "@/config/agents/agent-finance";
import {
  agentFinanceService,
  type AgentPayoutDetail,
  type AgentPayoutPreview,
  type AgentPayoutRow,
} from "@/services/agents-service";
import {
  receivingAccountsService,
  type ReceivingAccountOption,
} from "@/services/receiving-accounts-service";
import { attachmentsService } from "@/services/attachments-service";
import { useLocale } from "@/providers/locale-provider";
import { useUserContext } from "@/providers/user-context";
import { formatDate, fromISODate, toISODate } from "@/lib/date";
import { formatMoney } from "@/lib/money";
import { apiErrorMessage, reportApiError, toast } from "@/lib/toast";
import type { MessageKey } from "@/i18n/translate";
import { FieldNote } from "./field-note";

export function AgentPayoutsTab({
  agentId,
  agentLabel,
  onChanged,
}: {
  agentId: string;
  agentLabel: string;
  /** Balances shown elsewhere on the workspace change with every payout. */
  onChanged: () => void;
}) {
  const { t } = useLocale();
  const { hasPermission } = useUserContext();
  const canCreate = hasPermission("agents.payouts.create");
  const canReverse = hasPermission("agents.payouts.reverse");
  const [rows, setRows] = useState<AgentPayoutRow[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [detailId, setDetailId] = useState<string | null>(null);
  const [reverseTarget, setReverseTarget] = useState<AgentPayoutRow | null>(null);

  const load = useCallback(async () => {
    setLoadError(null);
    try {
      const result = await agentFinanceService.payouts(agentId, { pageSize: 100 });
      setRows(result.items);
    } catch (error) {
      setLoadError(apiErrorMessage(error, "errors.loadFailed"));
    }
  }, [agentId]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  const refresh = () => {
    void load();
    onChanged();
  };

  if (loadError) return <ErrorState description={loadError} onRetry={() => void load()} />;
  if (!rows) return null;

  const columns: CompactDetailColumn<AgentPayoutRow>[] = [
    {
      id: "number",
      header: t("agents.payouts.number"),
      cell: (row) => (
        <EnterpriseButton
          type="button"
          variant="ghost"
          size="inline"
          className={`num ${tableIdentityCellClass}`}
          onClick={() => setDetailId(row.id)}
        >
          {row.payoutNumber}
        </EnterpriseButton>
      ),
    },
    {
      id: "date",
      header: t("agents.payouts.date"),
      cell: (row) => <span className="num">{formatDate(row.payoutDate)}</span>,
    },
    {
      id: "amount",
      header: t("agents.payouts.amount"),
      align: "end",
      cell: (row) => <MoneyValue value={row.amount} currency={row.currency} />,
    },
    {
      id: "account",
      header: t("agents.payouts.account"),
      cell: (row) => row.payingAccount?.name ?? "—",
    },
    {
      id: "status",
      header: t("agents.fields.status"),
      cell: (row) => (
        <StatusBadge
          label={t(`agents.payouts.status.${row.status}`)}
          tone={row.status === "CONFIRMED" ? "success" : "destructive"}
        />
      ),
    },
    {
      id: "actions",
      header: "",
      align: "end",
      cell: (row) => (
        <RowActionsMenu
          label={t("common.actions")}
          actions={[
            {
              key: "view",
              label: t("agents.payouts.view"),
              icon: Eye,
              onSelect: () => setDetailId(row.id),
            },
            {
              key: "reverse",
              label: t("agents.payouts.reverse"),
              icon: Undo2,
              hidden: !canReverse || row.status !== "CONFIRMED",
              destructive: true,
              separatorBefore: true,
              onSelect: () => setReverseTarget(row),
            },
          ]}
        />
      ),
    },
  ];

  return (
    <DetailSection
      title={t("agents.payouts.title")}
      actions={
        canCreate ? (
          <EnterpriseButton type="button" size="sm" onClick={() => setCreateOpen(true)}>
            <Plus />
            {t("agents.payouts.new")}
          </EnterpriseButton>
        ) : null
      }
    >
      {rows.length === 0 ? (
        <EmptyState icon={Banknote} title={t("agents.payouts.empty")} />
      ) : (
        <CompactDetailTable columns={columns} rows={rows} rowKey={(row) => row.id} />
      )}

      {createOpen ? (
        <NewPayoutDialog
          agentId={agentId}
          agentLabel={agentLabel}
          onOpenChange={setCreateOpen}
          onCreated={refresh}
        />
      ) : null}

      {detailId ? (
        <PayoutDetailDialog
          payoutId={detailId}
          onOpenChange={(open) => !open && setDetailId(null)}
        />
      ) : null}

      {reverseTarget ? (
        <ReversePayoutDialog
          payout={reverseTarget}
          onOpenChange={(open) => !open && setReverseTarget(null)}
          onReversed={refresh}
        />
      ) : null}
    </DetailSection>
  );
}

function NewPayoutDialog({
  agentId,
  agentLabel,
  onOpenChange,
  onCreated,
}: {
  agentId: string;
  agentLabel: string;
  onOpenChange: (open: boolean) => void;
  onCreated: () => void;
}) {
  const { t } = useLocale();
  const fieldId = useId();
  // One key per dialog open: a retry or double click returns the same payout.
  const [idempotencyKey] = useState(() => newIdempotencyKey());
  const [preview, setPreview] = useState<AgentPayoutPreview | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [accounts, setAccounts] = useState<ReceivingAccountOption[]>([]);
  const [amount, setAmount] = useState("");
  const [payingAccountId, setPayingAccountId] = useState("");
  const [payoutDate, setPayoutDate] = useState(() => toISODate(new Date()));
  const [reference, setReference] = useState("");
  const [notes, setNotes] = useState("");
  const [evidence, setEvidence] = useState<ReceiptUploadItem[]>([]);
  const [showErrors, setShowErrors] = useState(false);
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    let cancelled = false;
    agentFinanceService
      .payoutPreview(agentId)
      .then((result) => !cancelled && setPreview(result))
      .catch(
        (error: unknown) =>
          !cancelled && setPreviewError(apiErrorMessage(error, "errors.loadFailed")),
      );
    receivingAccountsService
      .list()
      .then((result) => !cancelled && setAccounts(result))
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [agentId]);

  const currency = preview?.currency?.code ?? "";
  const available = preview?.available ?? 0;
  const amountError = payoutAmountError(amount, available);
  const uploading = evidence.some((item) => item.status === "uploading");
  const valid =
    !!preview &&
    preview.accountsConfigured &&
    !amountError &&
    !!payingAccountId &&
    !!reference.trim() &&
    !!payoutDate;

  const accountOptions = useMemo(
    () =>
      [...accounts]
        .sort(
          (a, b) =>
            Number(b.currencyId === preview?.currency?.id) -
            Number(a.currencyId === preview?.currency?.id),
        )
        .map((account) => ({ value: account.id, label: account.name })),
    [accounts, preview],
  );

  const submit = async () => {
    if (!valid || uploading) {
      setShowErrors(true);
      return;
    }
    setIsSaving(true);
    try {
      const created = await agentFinanceService.createPayout(agentId, {
        amount: Number(amount),
        payingAccountId,
        payoutDate,
        reference: reference.trim(),
        notes: notes.trim() || undefined,
        stagedAttachmentIds: evidence.length > 0 ? stagingIdsOf(evidence) : undefined,
        idempotencyKey,
      });
      toast.success(t("agents.payouts.created", { number: created.payoutNumber }));
      onCreated();
      onOpenChange(false);
    } catch (error) {
      reportApiError(error, "common.failedToSave");
    } finally {
      setIsSaving(false);
    }
  };

  const eligibleColumns: CompactDetailColumn<AgentPayoutPreview["eligibleEntries"][number]>[] = [
    {
      id: "entry",
      header: t("agents.payouts.entry"),
      cell: (row) => (
        <span className="flex flex-col">
          <span className="num">{row.entryNumber}</span>
          <span className="text-caption text-muted-foreground">
            {t(`agents.entryType.${row.entryType}` as MessageKey)}
          </span>
        </span>
      ),
    },
    {
      id: "availableAt",
      header: t("agents.payouts.availableAt"),
      cell: (row) => (
        <span className="num">{row.availableAt ? formatDate(row.availableAt) : "—"}</span>
      ),
    },
    {
      id: "remaining",
      header: t("agents.payouts.remaining"),
      align: "end",
      cell: (row) => <MoneyValue value={row.remaining} currency={currency} />,
    },
  ];

  const position = preview
    ? [
        { label: t("agents.payouts.balance"), value: preview.balance },
        { label: t("agents.payouts.pending"), value: preview.pending },
        { label: t("agents.payouts.deductions"), value: preview.deductions },
        { label: t("agents.payouts.paidOut"), value: preview.paidOut },
        { label: t("agents.payouts.available"), value: preview.available },
      ]
    : [];

  return (
    <EnterpriseModal
      open
      onOpenChange={onOpenChange}
      size="lg"
      layout="form-card"
      title={t("agents.payouts.dialogTitle", { agent: agentLabel })}
      isDirty={!!(amount || reference || notes || evidence.length)}
      footer={(requestClose) => (
        <CreateOperationFooter
          requestClose={requestClose}
          onSubmit={() => void submit()}
          isSubmitting={isSaving}
          submitDisabled={!preview || !preview.accountsConfigured || uploading}
          submitLabel={t("agents.payouts.submit")}
        />
      )}
    >
      {previewError ? (
        <ErrorState description={previewError} />
      ) : !preview ? (
        <p className="text-caption text-muted-foreground">{t("common.loading")}</p>
      ) : (
        <FormCardStack>
          {!preview.accountsConfigured ? (
            <Alert tone="warning">
              <AlertDescription>{t("agents.payouts.accountsNotConfigured")}</AlertDescription>
            </Alert>
          ) : null}
          <FormCardSection title={t("agents.payouts.positionTitle")}>
            <DetailFieldGrid columns={3}>
              {position.map((item) => (
                <DetailField
                  key={item.label}
                  label={item.label}
                  value={<MoneyValue value={item.value} currency={currency} />}
                />
              ))}
              {preview.carriedForwardNegative < 0 ? (
                <DetailField
                  label={t("agents.payouts.carriedNegative")}
                  value={<MoneyValue value={preview.carriedForwardNegative} currency={currency} />}
                />
              ) : null}
            </DetailFieldGrid>
          </FormCardSection>
          <FormCardSection title={t("agents.payouts.eligibleTitle")}>
            <CompactDetailTable
              columns={eligibleColumns}
              rows={preview.eligibleEntries}
              rowKey={(row) => row.id}
              empty={t("agents.payouts.eligibleEmpty")}
            />
          </FormCardSection>
          <FormCardSection title={t("agents.payouts.new")}>
            <FormCardRow>
              <FormCardField
                size="sm"
                required
                label={`${t("agents.payouts.amount")} (${currency})`}
                htmlFor={`${fieldId}-amount`}
                message={
                  <FieldNote
                    error={
                      showErrors && amountError
                        ? t(`agents.payouts.errors.${amountError}` as MessageKey)
                        : null
                    }
                    hint={t("agents.payouts.amountHint", {
                      amount: formatMoney(available, currency),
                    })}
                  />
                }
              >
                <MoneyInput
                  id={`${fieldId}-amount`}
                  value={amount}
                  aria-invalid={showErrors && !!amountError}
                  onChange={(event) => setAmount(event.target.value)}
                />
              </FormCardField>
              <FormCardField
                size="md"
                required
                label={t("agents.payouts.payingAccount")}
                htmlFor={`${fieldId}-account`}
                message={
                  <FieldNote
                    error={
                      showErrors && !payingAccountId
                        ? t("agents.payouts.errors.accountRequired")
                        : null
                    }
                  />
                }
              >
                <SearchableSelect
                  id={`${fieldId}-account`}
                  value={payingAccountId}
                  onValueChange={setPayingAccountId}
                  options={accountOptions}
                  placeholder={t("agents.agreements.choose")}
                  error={showErrors && !payingAccountId}
                />
              </FormCardField>
            </FormCardRow>
            <FormCardRow>
              <FormCardField
                size="sm"
                required
                label={t("agents.payouts.payoutDate")}
                htmlFor={`${fieldId}-date`}
                message={
                  <FieldNote
                    error={
                      showErrors && !payoutDate ? t("agents.payouts.errors.dateRequired") : null
                    }
                  />
                }
              >
                <EnterpriseDatePicker
                  id={`${fieldId}-date`}
                  value={fromISODate(payoutDate)}
                  onChange={(date) => setPayoutDate(date ? toISODate(date) : "")}
                />
              </FormCardField>
              <FormCardField
                size="md"
                required
                label={t("agents.payouts.reference")}
                htmlFor={`${fieldId}-reference`}
                message={
                  <FieldNote
                    error={
                      showErrors && !reference.trim()
                        ? t("agents.payouts.errors.referenceRequired")
                        : null
                    }
                    hint={t("agents.payouts.referenceHint")}
                  />
                }
              >
                <Input
                  id={`${fieldId}-reference`}
                  dir="auto"
                  value={reference}
                  aria-invalid={showErrors && !reference.trim()}
                  onChange={(event) => setReference(event.target.value)}
                />
              </FormCardField>
            </FormCardRow>
            <FormCardField label={t("agents.payouts.notes")} htmlFor={`${fieldId}-notes`}>
              <Textarea
                id={`${fieldId}-notes`}
                rows={2}
                value={notes}
                onChange={(event) => setNotes(event.target.value)}
              />
            </FormCardField>
            <PaymentReceiptsField items={evidence} onChange={setEvidence} disabled={isSaving} />
          </FormCardSection>
        </FormCardStack>
      )}
    </EnterpriseModal>
  );
}

/** Payout detail — amounts, paid credits, ledger entries (with journal links) and evidence. */
export function PayoutDetailDialog({
  payoutId,
  onOpenChange,
}: {
  payoutId: string;
  onOpenChange: (open: boolean) => void;
}) {
  const { t } = useLocale();
  const [detail, setDetail] = useState<AgentPayoutDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState<{
    title: string;
    mimeType: string | null;
    blob: Blob;
  } | null>(null);

  useEffect(() => {
    let cancelled = false;
    agentFinanceService
      .payoutDetail(payoutId)
      .then((result) => !cancelled && setDetail(result))
      .catch(
        (failure: unknown) => !cancelled && setError(apiErrorMessage(failure, "errors.loadFailed")),
      );
    return () => {
      cancelled = true;
    };
  }, [payoutId]);

  const openAttachment = async (attachment: AgentPayoutDetail["attachments"][number]) => {
    try {
      const blob = await attachmentsService.download(attachment.attachmentId);
      setPreview({ title: attachment.fileName, mimeType: attachment.mimeType, blob });
    } catch (failure) {
      reportApiError(failure, "errors.loadFailed");
    }
  };

  return (
    <>
      <EnterpriseModal
        open
        onOpenChange={onOpenChange}
        size="md"
        title={t("agents.payouts.detailTitle", { number: detail?.payoutNumber ?? "" })}
        description={detail ? `${detail.agent.name} · ${detail.agent.agentNumber}` : undefined}
        footer={
          <EnterpriseButton
            type="button"
            variant="outline"
            size="sm"
            onClick={() => onOpenChange(false)}
          >
            {t("common.close")}
          </EnterpriseButton>
        }
      >
        {error ? (
          <ErrorState description={error} />
        ) : !detail ? (
          <p className="text-caption text-muted-foreground">{t("common.loading")}</p>
        ) : (
          <div className="flex flex-col gap-3">
            <DetailFieldGrid columns={2}>
              <DetailField
                label={t("agents.payouts.amount")}
                value={<MoneyValue value={detail.amount} currency={detail.currency} />}
              />
              <DetailField
                label={t("agents.fields.status")}
                value={
                  <StatusBadge
                    label={t(`agents.payouts.status.${detail.status}`)}
                    tone={detail.status === "CONFIRMED" ? "success" : "destructive"}
                  />
                }
              />
              <DetailField label={t("agents.payouts.date")} value={formatDate(detail.payoutDate)} />
              <DetailField label={t("agents.payouts.account")} value={detail.payingAccount?.name} />
              <DetailField label={t("agents.payouts.reference")} value={detail.reference} />
              <DetailField label={t("agents.payouts.notes")} value={detail.notes} />
              <DetailField
                label={t("agents.payouts.allocations")}
                value={<span className="num">{detail.allocations.length}</span>}
              />
              <DetailField
                label={t("agents.payouts.reversalReason")}
                value={detail.reversalReason}
              />
            </DetailFieldGrid>
            <div className="flex flex-col gap-1">
              <h3 className="text-caption font-semibold">{t("agents.payouts.ledgerEntries")}</h3>
              <ul className="flex flex-col gap-1 text-caption">
                {detail.ledgerEntries.map((entry) => (
                  <li key={entry.id} className="flex flex-wrap items-center gap-2">
                    <span className="num">{entry.entryNumber}</span>
                    <span>{t(`agents.entryType.${entry.entryType}` as MessageKey)}</span>
                    <StatusBadge
                      label={t(`agents.postingStatus.${entry.postingStatus}` as MessageKey)}
                      tone={entry.postingStatus === "POSTED" ? "success" : "warning"}
                    />
                    {entry.journalEntryId ? (
                      <Link
                        href={`/finance/journal-entries/${entry.journalEntryId}`}
                        className="text-primary hover:underline"
                      >
                        {t("agents.statement.journal")}
                      </Link>
                    ) : null}
                  </li>
                ))}
              </ul>
            </div>
            <div className="flex flex-col gap-1">
              <h3 className="text-caption font-semibold">{t("agents.payouts.evidence")}</h3>
              {detail.attachments.length === 0 ? (
                <p className="text-caption text-muted-foreground">
                  {t("agents.payouts.noEvidence")}
                </p>
              ) : (
                <ul className="flex flex-wrap gap-2">
                  {detail.attachments.map((attachment) => (
                    <li key={attachment.id}>
                      <EnterpriseButton
                        type="button"
                        size="sm"
                        variant="outline"
                        onClick={() => void openAttachment(attachment)}
                      >
                        <FileText />
                        <span className="max-w-48 truncate" dir="ltr">
                          {attachment.fileName}
                        </span>
                      </EnterpriseButton>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        )}
      </EnterpriseModal>
      <AttachmentPreviewDialog
        open={!!preview}
        onOpenChange={(open) => !open && setPreview(null)}
        title={preview?.title ?? ""}
        mimeType={preview?.mimeType ?? null}
        blob={preview?.blob ?? null}
      />
    </>
  );
}

function ReversePayoutDialog({
  payout,
  onOpenChange,
  onReversed,
}: {
  payout: AgentPayoutRow;
  onOpenChange: (open: boolean) => void;
  onReversed: () => void;
}) {
  const { t } = useLocale();
  const fieldId = useId();
  const [reason, setReason] = useState("");
  const [isBusy, setIsBusy] = useState(false);

  const reverse = async () => {
    if (!reason.trim()) return;
    setIsBusy(true);
    try {
      await agentFinanceService.reversePayout(payout.id, reason.trim());
      toast.success(t("agents.payouts.reversed"));
      onReversed();
      onOpenChange(false);
    } catch (error) {
      reportApiError(error, "errors.generic");
    } finally {
      setIsBusy(false);
    }
  };

  return (
    <ConfirmationDialog
      open
      onOpenChange={onOpenChange}
      tone="destructive"
      title={t("agents.payouts.reverseTitle", { number: payout.payoutNumber })}
      description={t("agents.payouts.reverseDescription")}
      extra={
        <div className="flex flex-col gap-1">
          <Label htmlFor={fieldId}>{t("agents.payouts.reverseReason")}</Label>
          <Textarea
            id={fieldId}
            rows={2}
            value={reason}
            onChange={(event) => setReason(event.target.value)}
          />
        </div>
      }
      confirmLabel={t("agents.payouts.reverse")}
      confirmDisabled={!reason.trim()}
      isConfirming={isBusy}
      onConfirm={() => void reverse()}
    />
  );
}
