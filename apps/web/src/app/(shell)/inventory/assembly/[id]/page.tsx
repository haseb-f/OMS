"use client";

import { useCallback, useEffect, useId, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { AlertTriangle, Boxes, Info, Undo2 } from "lucide-react";
import {
  DetailField,
  DetailSection,
  DetailSummaryBar,
  EditorHeader,
  EditorWorkspace,
} from "@/components/shared/detail-workspace";
import { HeaderActions } from "@/components/shared/header-actions";
import { ConfirmationDialog } from "@/components/shared/confirmation-dialog";
import { EmptyState } from "@/components/shared/empty-state";
import { ErrorState } from "@/components/shared/error-state";
import { PermissionGate } from "@/components/shared/permission-gate";
import { MoneyValue } from "@/components/shared/money-value";
import { SemanticValue } from "@/components/shared/semantic-value";
import { CompactDetailTable } from "@/components/shared/data-table/compact-detail-table";
import { RelatedRecordsButton } from "@/components/shared/related-records-panel";
import { StatusBadge } from "@/components/business/status-badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import {
  ASSEMBLY_PERMISSIONS,
  ASSEMBLY_STATUS_TONE,
  assemblyErrorMessage,
} from "@/config/inventory/assembly";
import { useUsersLookup } from "@/hooks/use-reference-data";
import { formatDateTime } from "@/lib/date";
import { formatNumber } from "@/lib/format-number";
import { formatAmount } from "@/lib/money";
import { apiErrorMessage, reportDestructiveDone } from "@/lib/toast";
import { useBreadcrumbLabel } from "@/providers/breadcrumb-provider";
import { useLocale } from "@/providers/locale-provider";
import { useUserContext } from "@/providers/user-context";
import { ApiError } from "@/services/api-client";
import {
  assemblyService,
  type AssemblyOrder,
  type AssemblyOrderLine,
} from "@/services/assembly-service";

function unitCostText(value: string | null) {
  return value === null ? (
    "—"
  ) : (
    <span dir="ltr" className="num">
      {formatAmount(value, { decimals: 4 })}
    </span>
  );
}

function AssemblyDetailContent() {
  const params = useParams<{ id: string }>();
  const { t } = useLocale();
  const { hasPermission } = useUserContext();
  const canReverse = hasPermission(ASSEMBLY_PERMISSIONS.reverse);
  const canOpenProduct = hasPermission("products.view");
  const users = useUsersLookup();
  const reasonId = useId();

  const [order, setOrder] = useState<AssemblyOrder | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<{ notFound: boolean; message: string } | null>(null);
  const [reverseOpen, setReverseOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [isReversing, setIsReversing] = useState(false);
  const [reverseError, setReverseError] = useState<string | null>(null);

  useBreadcrumbLabel(order?.assemblyNumber ?? null);

  const load = useCallback(async () => {
    setIsLoading(true);
    setLoadError(null);
    try {
      setOrder(await assemblyService.get(params.id));
    } catch (error) {
      setOrder(null);
      setLoadError({
        notFound: error instanceof ApiError && error.status === 404,
        message: apiErrorMessage(error, "errors.loadFailed"),
      });
    } finally {
      setIsLoading(false);
    }
  }, [params.id]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  const closeReverse = () => {
    setReverseOpen(false);
    setReason("");
    setReverseError(null);
  };

  const confirmReverse = async () => {
    if (!order || !reason.trim()) return;
    setIsReversing(true);
    setReverseError(null);
    try {
      const reversed = await assemblyService.reverse(order.id, reason.trim());
      // The page shows the server's state in place; the toast only supplements it.
      setOrder(reversed);
      reportDestructiveDone(t("assembly.success.reversed", { number: reversed.assemblyNumber }));
      closeReverse();
    } catch (error) {
      // Kept in the dialog: the reason (e.g. the finished item was already sold) stays readable.
      setReverseError(
        assemblyErrorMessage(error, t) ?? apiErrorMessage(error, "errors.saveFailed"),
      );
    } finally {
      setIsReversing(false);
    }
  };

  if (isLoading) {
    return (
      <EditorWorkspace>
        <Skeleton className="h-16 w-full" />
        <Skeleton className="h-48 w-full" />
      </EditorWorkspace>
    );
  }
  if (!order) {
    return (
      <EditorWorkspace>
        {loadError && !loadError.notFound ? (
          <ErrorState description={loadError.message} onRetry={() => void load()} />
        ) : (
          <EmptyState icon={Boxes} title={t("assembly.errors.ASSEMBLY_NOT_FOUND")} />
        )}
      </EditorWorkspace>
    );
  }

  const showCost = order.totalCost !== null;
  const movementsHref = `/inventory/movements?referenceId=${order.id}`;
  const productLabel = `${order.product.sku} ${order.product.name}`;

  return (
    <EditorWorkspace>
      <EditorHeader
        title={t("assembly.detail.title")}
        documentNumber={order.assemblyNumber}
        copyValue={order.assemblyNumber}
        status={
          <StatusBadge
            tone={ASSEMBLY_STATUS_TONE[order.status]}
            label={t(`assembly.status.${order.status}`)}
          />
        }
        actions={
          <HeaderActions
            destructive={[
              {
                key: "reverse",
                label: t("assembly.reverse.action"),
                icon: Undo2,
                hidden: !canReverse || order.status !== "POSTED",
                // Opens its own confirmation (with the required reason).
                onSelect: () => setReverseOpen(true),
              },
            ]}
          />
        }
      />

      <DetailSummaryBar>
        <DetailField
          label={t("assembly.fields.product")}
          className="col-span-2"
          value={
            canOpenProduct ? (
              <Link href={`/products/${order.productId}`} className="text-primary hover:underline">
                {productLabel}
              </Link>
            ) : (
              productLabel
            )
          }
        />
        <DetailField
          label={t("assembly.fields.warehouse")}
          value={`${order.warehouse.code} — ${order.warehouse.name}`}
        />
        <DetailField
          label={t("assembly.fields.quantity")}
          value={
            <span dir="ltr" className="num">
              {formatNumber(order.quantity)}
            </span>
          }
        />
        <DetailField
          label={t("assembly.fields.recipeVersion")}
          value={t("assembly.versionLabel", { version: order.recipeVersion })}
        />
        <DetailField
          label={t("assembly.fields.date")}
          value={<SemanticValue kind="date">{formatDateTime(order.createdAt)}</SemanticValue>}
        />
        <DetailField
          label={t("products.fields.createdBy")}
          value={order.createdBy ? users[order.createdBy] : undefined}
        />
      </DetailSummaryBar>

      {order.ownerAgentId ? (
        <Alert tone="info">
          <Info />
          <AlertDescription>{t("assembly.detail.agentOwnedNote")}</AlertDescription>
        </Alert>
      ) : null}

      <DetailSection
        title={t("assembly.detail.lines")}
        actions={
          <Link href={movementsHref} className="text-caption text-primary hover:underline">
            {t("assembly.detail.viewMovements")}
          </Link>
        }
      >
        <CompactDetailTable<AssemblyOrderLine>
          stacked
          rows={order.lines}
          rowKey={(line) => line.id}
          columns={[
            {
              id: "component",
              header: t("assembly.fields.component"),
              cell: (line) => (
                <span className="flex min-w-0 flex-col">
                  <span className="truncate">{line.componentName}</span>
                  <SemanticValue kind="id" className="text-caption text-muted-foreground">
                    {line.componentSku}
                  </SemanticValue>
                </span>
              ),
            },
            {
              id: "consumed",
              header: t("assembly.fields.consumed"),
              align: "end",
              cell: (line) => (
                <span dir="ltr" className="num">
                  {formatNumber(line.quantity)}
                </span>
              ),
            },
            ...(showCost
              ? [
                  {
                    id: "unitCost",
                    header: t("assembly.fields.unitCost"),
                    align: "end" as const,
                    cell: (line: AssemblyOrderLine) => unitCostText(line.unitCost),
                  },
                  {
                    id: "value",
                    header: t("assembly.fields.value"),
                    align: "end" as const,
                    cell: (line: AssemblyOrderLine) =>
                      line.value === null ? "—" : <MoneyValue value={line.value} />,
                    footer:
                      order.componentCost !== null ? (
                        <MoneyValue value={order.componentCost} />
                      ) : undefined,
                  },
                ]
              : []),
            {
              id: "movement",
              header: t("assembly.fields.movement"),
              cell: (line) =>
                line.consumptionMovementId ? (
                  <RelatedRecordsButton
                    kind="INVENTORY_MOVEMENT"
                    id={line.reversalMovementId ?? line.consumptionMovementId}
                    number={`${order.assemblyNumber} · ${line.componentSku}`}
                  />
                ) : (
                  "—"
                ),
            },
          ]}
        />
      </DetailSection>

      <DetailSection title={t("assembly.detail.totals")}>
        {showCost ? (
          <DetailSummaryBar className="border-0 p-0">
            <DetailField
              label={t("assembly.fields.componentCost")}
              value={
                order.componentCost !== null ? (
                  <MoneyValue value={order.componentCost} />
                ) : undefined
              }
            />
            <DetailField
              label={t("assembly.fields.directCost")}
              value={
                order.directCost !== null ? <MoneyValue value={order.directCost} /> : undefined
              }
            />
            <DetailField
              label={t("assembly.fields.totalCost")}
              value={order.totalCost !== null ? <MoneyValue value={order.totalCost} /> : undefined}
            />
            <DetailField
              label={t("assembly.fields.unitCost")}
              value={unitCostText(order.unitCost)}
            />
          </DetailSummaryBar>
        ) : (
          <p className="text-caption text-muted-foreground">{t("assembly.detail.costHidden")}</p>
        )}
        {order.outputMovementId ? (
          <div className="flex flex-wrap items-center gap-2 text-caption text-muted-foreground">
            <span>{t("assembly.detail.outputMovement")}</span>
            <RelatedRecordsButton
              kind="INVENTORY_MOVEMENT"
              id={order.outputMovementId}
              number={`${order.assemblyNumber} · ${order.product.sku}`}
            />
          </div>
        ) : null}
        {order.notes ? (
          <p className="text-caption text-muted-foreground">
            {t("assembly.fields.notes")}: <span className="text-foreground">{order.notes}</span>
          </p>
        ) : null}
      </DetailSection>

      {order.status === "REVERSED" ? (
        <DetailSection title={t("assembly.detail.reversal")}>
          <DetailSummaryBar className="border-0 p-0">
            <DetailField
              label={t("assembly.fields.reversedAt")}
              value={
                order.reversedAt ? (
                  <SemanticValue kind="date">{formatDateTime(order.reversedAt)}</SemanticValue>
                ) : undefined
              }
            />
            <DetailField
              label={t("assembly.fields.reversedBy")}
              value={order.reversedBy ? users[order.reversedBy] : undefined}
            />
            <DetailField
              label={t("assembly.fields.reversalReason")}
              className="col-span-2"
              value={order.reversalReason}
            />
          </DetailSummaryBar>
        </DetailSection>
      ) : null}

      <ConfirmationDialog
        open={reverseOpen}
        onOpenChange={(open) => (open ? setReverseOpen(true) : closeReverse())}
        tone="destructive"
        title={t("assembly.reverse.title", { number: order.assemblyNumber })}
        description={t("assembly.reverse.description")}
        extra={
          <div className="flex flex-col gap-2">
            <p className="text-caption text-muted-foreground">
              {t("assembly.reverse.condition", {
                quantity: formatNumber(order.quantity),
                warehouse: order.warehouse.name,
              })}
            </p>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor={reasonId}>{t("assembly.reverse.reasonLabel")}</Label>
              <Textarea
                id={reasonId}
                value={reason}
                maxLength={500}
                placeholder={t("assembly.reverse.reasonPlaceholder")}
                onChange={(event) => setReason(event.target.value)}
              />
            </div>
            {reverseError ? (
              <Alert tone="destructive">
                <AlertTriangle />
                <AlertDescription>{reverseError}</AlertDescription>
              </Alert>
            ) : null}
          </div>
        }
        confirmLabel={t("assembly.reverse.confirm")}
        confirmDisabled={!reason.trim()}
        isConfirming={isReversing}
        onConfirm={() => void confirmReverse()}
      />
    </EditorWorkspace>
  );
}

export default function AssemblyDetailPage() {
  return (
    <PermissionGate permission={ASSEMBLY_PERMISSIONS.view}>
      <AssemblyDetailContent />
    </PermissionGate>
  );
}
