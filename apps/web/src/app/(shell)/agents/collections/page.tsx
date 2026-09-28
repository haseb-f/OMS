"use client";

import { useCallback, useEffect, useId, useMemo, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import type { ColumnDef } from "@tanstack/react-table";
import { CheckCircle2, FileText, XCircle } from "lucide-react";
import { PageWorkspace } from "@/components/shared/page-workspace";
import { PermissionGate } from "@/components/shared/permission-gate";
import { EnterpriseDataTable } from "@/components/master-data/enterprise-data-table";
import { SelectFilter } from "@/components/shared/data-table";
import { ConfirmationDialog } from "@/components/shared/confirmation-dialog";
import { MoneyValue } from "@/components/shared/money-value";
import { StackedCell } from "@/components/shared/stacked-cell";
import { SemanticValue } from "@/components/shared/semantic-value";
import { EnterpriseButton } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { StatusBadge } from "@/components/business/status-badge";
import { AttachmentPreviewDialog } from "@/components/business/attachment-preview-dialog";
import { AgentBadge, AgentFilter } from "@/components/agents/agent-options";
import {
  agentFinanceService,
  type AgentCollectionRow,
  type AgentCollectionStatusFilter,
} from "@/services/agents-service";
import { attachmentsService } from "@/services/attachments-service";
import { useLocale } from "@/providers/locale-provider";
import { useUserContext } from "@/providers/user-context";
import { formatDate } from "@/lib/date";
import { formatMoney } from "@/lib/money";
import { apiErrorMessage, reportApiError, toast } from "@/lib/toast";
import type { StatusTone } from "@/components/business/status-tone";

const STATUS_FILTERS: AgentCollectionStatusFilter[] = [
  "AWAITING",
  "VERIFIED",
  "REJECTED",
  "DISPUTED",
];

const STATUS_TONE: Record<AgentCollectionRow["status"], StatusTone> = {
  PENDING: "warning",
  MATCHED: "info",
  VERIFIED: "success",
  REJECTED: "destructive",
  DISPUTED: "destructive",
};

export default function AgentCollectionsPage() {
  return (
    <PermissionGate permission="agents.finance.view">
      <AgentCollectionsContent />
    </PermissionGate>
  );
}

type Preview = { title: string; mimeType: string | null; blob: Blob };

function EvidenceCell({
  row,
  onPreview,
}: {
  row: AgentCollectionRow;
  onPreview: (preview: Preview) => void;
}) {
  const { t } = useLocale();
  const files = row.attachments.filter((attachment) => attachment.attachmentId);
  if (files.length === 0) {
    return <span className="text-muted-foreground">{t("agents.collections.noEvidence")}</span>;
  }
  return (
    <span className="flex flex-wrap gap-1">
      {files.map((attachment) => (
        <EnterpriseButton
          key={attachment.id}
          type="button"
          size="sm"
          variant="outline"
          onClick={async () => {
            try {
              const blob = await attachmentsService.download(attachment.attachmentId!);
              onPreview({ title: attachment.fileName ?? "", mimeType: blob.type || null, blob });
            } catch (error) {
              reportApiError(error, "errors.loadFailed");
            }
          }}
        >
          <FileText />
          <span className="max-w-28 truncate" dir="ltr">
            {attachment.fileName}
          </span>
        </EnterpriseButton>
      ))}
    </span>
  );
}

function AgentCollectionsContent() {
  const { t } = useLocale();
  const searchParams = useSearchParams();
  const { hasPermission } = useUserContext();
  const canVerify = hasPermission("agents.finance.verify");
  const reasonId = useId();
  const [items, setItems] = useState<AgentCollectionRow[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [search, setSearch] = useState("");
  const [agentId, setAgentId] = useState(() => searchParams.get("agentId") ?? "");
  const [status, setStatus] = useState<AgentCollectionStatusFilter>("AWAITING");
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [verifyTarget, setVerifyTarget] = useState<AgentCollectionRow | null>(null);
  const [rejectTarget, setRejectTarget] = useState<AgentCollectionRow | null>(null);
  const [reason, setReason] = useState("");
  const [isBusy, setIsBusy] = useState(false);
  const [preview, setPreview] = useState<Preview | null>(null);

  const load = useCallback(async () => {
    setIsLoading(true);
    setLoadError(null);
    try {
      const result = await agentFinanceService.collections({
        agentId: agentId || undefined,
        status,
        search: search || undefined,
        page,
        pageSize,
      });
      setItems(result.items);
      setTotal(result.total);
    } catch (error) {
      setLoadError(apiErrorMessage(error, "errors.loadFailed"));
    } finally {
      setIsLoading(false);
    }
  }, [agentId, status, search, page, pageSize]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  const verify = async () => {
    if (!verifyTarget) return;
    setIsBusy(true);
    try {
      await agentFinanceService.verifyCollection(verifyTarget.id);
      toast.success(t("agents.collections.verified"));
      setVerifyTarget(null);
      await load();
    } catch (error) {
      reportApiError(error, "errors.generic");
    } finally {
      setIsBusy(false);
    }
  };

  const reject = async () => {
    if (!rejectTarget || !reason.trim()) return;
    setIsBusy(true);
    try {
      await agentFinanceService.rejectCollection(rejectTarget.id, reason.trim());
      toast.success(t("agents.collections.rejected"));
      setRejectTarget(null);
      setReason("");
      await load();
    } catch (error) {
      reportApiError(error, "errors.generic");
    } finally {
      setIsBusy(false);
    }
  };

  const columns = useMemo<ColumnDef<AgentCollectionRow, unknown>[]>(
    () => [
      {
        id: "payment",
        meta: {
          titleKey: "agents.collections.payment",
          stacked: true,
          type: "code",
          importance: "critical",
          minWidth: 130,
        },
        enableSorting: false,
        accessorFn: (row) => row.paymentNumber,
        cell: ({ row }) => (
          <StackedCell
            primary={<SemanticValue kind="id">{row.original.paymentNumber}</SemanticValue>}
            secondary={formatDate(row.original.paymentDate)}
          />
        ),
      },
      {
        id: "agent",
        meta: { titleKey: "agents.collections.agent", importance: "high", minWidth: 140 },
        enableSorting: false,
        accessorFn: (row) => row.agent?.name ?? "",
        cell: ({ row }) => <AgentBadge agent={row.original.agent} />,
      },
      {
        id: "order",
        meta: {
          titleKey: "agents.collections.order",
          stacked: true,
          importance: "high",
          minWidth: 150,
        },
        enableSorting: false,
        accessorFn: (row) => row.storeOrder?.internalOrderId ?? "",
        cell: ({ row }) =>
          row.original.storeOrder ? (
            <StackedCell
              primary={
                <Link
                  href={`/store-orders/${row.original.storeOrder.id}`}
                  className="num text-primary hover:underline"
                >
                  {row.original.storeOrder.internalOrderId}
                </Link>
              }
              secondary={row.original.storeOrder.partner?.name ?? undefined}
            />
          ) : (
            "—"
          ),
      },
      {
        id: "destination",
        meta: {
          titleKey: "agents.collections.destination",
          stacked: true,
          importance: "medium",
          minWidth: 140,
        },
        enableSorting: false,
        accessorFn: (row) => row.agentPaymentDestination?.label ?? "",
        cell: ({ row }) => (
          <StackedCell
            primary={row.original.agentPaymentDestination?.label ?? "—"}
            secondary={row.original.paymentMethod?.name ?? undefined}
          />
        ),
      },
      {
        id: "reference",
        meta: { titleKey: "agents.collections.reference", importance: "low", defaultHidden: true },
        enableSorting: false,
        accessorFn: (row) => row.referenceNumber ?? row.senderName ?? "",
      },
      {
        id: "amount",
        meta: { titleKey: "agents.collections.amount", type: "money", importance: "critical" },
        enableSorting: false,
        accessorFn: (row) => row.amount,
        cell: ({ row }) => (
          <MoneyValue value={row.original.amount} currency={row.original.currency} />
        ),
      },
      {
        id: "status",
        meta: { titleKey: "agents.collections.status", type: "status", importance: "high" },
        enableSorting: false,
        accessorFn: (row) => row.status,
        cell: ({ row }) => (
          <StackedCell
            primary={
              <StatusBadge
                label={t(`agents.collections.statusValues.${row.original.status}`)}
                tone={STATUS_TONE[row.original.status]}
              />
            }
            secondary={
              row.original.rejectionReason ??
              row.original.verifiedBy?.fullName ??
              row.original.rejectedBy?.fullName ??
              undefined
            }
          />
        ),
      },
      {
        id: "evidence",
        meta: { titleKey: "agents.collections.evidence", importance: "medium", minWidth: 120 },
        enableSorting: false,
        cell: ({ row }) => <EvidenceCell row={row.original} onPreview={setPreview} />,
      },
      ...(canVerify
        ? ([
            {
              id: "__actions",
              meta: { titleKey: "common.actions", importance: "critical" },
              enableSorting: false,
              enableHiding: false,
              cell: ({ row }) =>
                row.original.status === "PENDING" || row.original.status === "MATCHED" ? (
                  <span className="flex flex-wrap justify-end gap-1">
                    <EnterpriseButton
                      type="button"
                      size="sm"
                      variant="success"
                      onClick={() => setVerifyTarget(row.original)}
                    >
                      <CheckCircle2 />
                      {t("agents.collections.verify")}
                    </EnterpriseButton>
                    <EnterpriseButton
                      type="button"
                      size="sm"
                      variant="outline"
                      onClick={() => {
                        setReason("");
                        setRejectTarget(row.original);
                      }}
                    >
                      <XCircle />
                      {t("agents.collections.reject")}
                    </EnterpriseButton>
                  </span>
                ) : null,
            },
          ] satisfies ColumnDef<AgentCollectionRow, unknown>[])
        : []),
    ],
    [canVerify, t],
  );

  return (
    <PageWorkspace
      dense
      title={t("agents.collections.title")}
      description={t("agents.collections.description")}
    >
      <EnterpriseDataTable
        tableId="agent-collections"
        printTitle={t("agents.collections.title")}
        columns={columns}
        data={items}
        totalCount={total}
        page={page}
        pageSize={pageSize}
        onPageChange={setPage}
        onPageSizeChange={(size) => {
          setPageSize(size);
          setPage(1);
        }}
        search={search}
        onSearchChange={(value) => {
          setSearch(value);
          setPage(1);
        }}
        isLoading={isLoading}
        error={loadError}
        onRetry={() => void load()}
        onRefresh={() => void load()}
        filterBar={
          <>
            <AgentFilter
              value={agentId}
              onChange={(value) => {
                setAgentId(value);
                setPage(1);
              }}
            />
            <SelectFilter
              label={t("agents.collections.status")}
              value={status}
              showAllOption={false}
              onChange={(value) => {
                setStatus((value || "AWAITING") as AgentCollectionStatusFilter);
                setPage(1);
              }}
              options={STATUS_FILTERS.map((value) => ({
                value,
                label: t(`agents.collections.statusValues.${value}`),
              }))}
            />
          </>
        }
        activeFilterCount={(agentId ? 1 : 0) + (status !== "AWAITING" ? 1 : 0)}
        onClearFilters={() => {
          setAgentId("");
          setStatus("AWAITING");
          setPage(1);
        }}
        emptyTitle={t("agents.collections.empty")}
        getRowId={(row) => row.id}
      />

      <ConfirmationDialog
        open={!!verifyTarget}
        onOpenChange={(open) => !open && setVerifyTarget(null)}
        tone="success"
        title={t("agents.collections.verifyTitle", { number: verifyTarget?.paymentNumber ?? "" })}
        description={t("agents.collections.verifyDescription", {
          amount: verifyTarget ? formatMoney(verifyTarget.amount, verifyTarget.currency?.code) : "",
        })}
        confirmLabel={t("agents.collections.verify")}
        isConfirming={isBusy}
        onConfirm={() => void verify()}
      />

      <ConfirmationDialog
        open={!!rejectTarget}
        onOpenChange={(open) => !open && setRejectTarget(null)}
        tone="destructive"
        title={t("agents.collections.rejectTitle", { number: rejectTarget?.paymentNumber ?? "" })}
        description={t("agents.collections.rejectDescription")}
        extra={
          <div className="flex flex-col gap-1">
            <Label htmlFor={reasonId}>{t("agents.collections.rejectReason")}</Label>
            <Textarea
              id={reasonId}
              rows={2}
              value={reason}
              onChange={(event) => setReason(event.target.value)}
            />
          </div>
        }
        confirmLabel={t("agents.collections.reject")}
        confirmDisabled={!reason.trim()}
        isConfirming={isBusy}
        onConfirm={() => void reject()}
      />

      <AttachmentPreviewDialog
        open={!!preview}
        onOpenChange={(open) => !open && setPreview(null)}
        title={preview?.title ?? ""}
        mimeType={preview?.mimeType ?? null}
        blob={preview?.blob ?? null}
      />
    </PageWorkspace>
  );
}
