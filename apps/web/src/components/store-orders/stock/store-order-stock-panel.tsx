"use client";

import { useCallback, useEffect, useState, type ReactNode } from "react";
import { AlertTriangle, PackageOpen, PackagePlus, RefreshCw } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { EnterpriseButton } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  tableNumericCellClass,
} from "@/components/ui/table";
import { StatusBadge } from "@/components/business/status-badge";
import { CollapsibleDetailSection, DetailSection } from "@/components/shared/detail-workspace";
import { useLocale } from "@/providers/locale-provider";
import { useUserContext } from "@/providers/user-context";
import { reportApiError, toast } from "@/lib/toast";
import { formatDateTime } from "@/lib/date";
import { formatAmount } from "@/lib/money";
import { ltrIsolate } from "@/lib/bidi";
import type { MessageKey } from "@/i18n/translate";
import { StockStatusChip } from "./stock-status-chip";
import { WarehouseRoleBadge } from "./warehouse-role-badge";
import { ReceiveBackDialog } from "./receive-back-dialog";
import { storeOrderStockApi, type StoreOrderStockView } from "./stock-api";

/**
 * R15 W5a (spec §6, requirement 5.16) — the order's stock: per line what is
 * ordered, reserved (and where), with the carrier, delivered, received back
 * (saleable / damaged) and short; the shortage reason; every linked movement;
 * the shipments with their quantities. Actions: "Reserve now"
 * (`store-orders.edit`), "Receive returned goods"
 * (`shipping.receive_returns`), and a new shipment for the remaining
 * quantities once the current one was delivered (`shipping.edit`).
 * `refreshKey` reloads it after the page changed the order.
 */
export function StoreOrderStockPanel({
  orderId,
  refreshKey,
  onChanged,
}: {
  orderId: string;
  /** Any value that changes when the order changed elsewhere (e.g. the page's related-records key). */
  refreshKey?: string | number;
  onChanged?: () => void;
}) {
  const { t, locale } = useLocale();
  const { hasPermission } = useUserContext();
  const [view, setView] = useState<StoreOrderStockView | null>(null);
  const [busy, setBusy] = useState(false);
  const [receiving, setReceiving] = useState(false);
  const [movementsOpen, setMovementsOpen] = useState(false);

  const load = useCallback(() => {
    storeOrderStockApi
      .view(orderId)
      .then(setView)
      .catch((error: unknown) => reportApiError(error, "storeOrderStock.errors.load"));
  }, [orderId]);

  useEffect(() => {
    load();
  }, [load, refreshKey]);

  const changed = (updated: StoreOrderStockView) => {
    setView(updated);
    onChanged?.();
  };

  const reserve = async () => {
    setBusy(true);
    try {
      const updated = await storeOrderStockApi.reserve(orderId);
      toast.success(
        t(
          updated.stockStatus === "SHORT"
            ? "storeOrderStock.toasts.stillShort"
            : "storeOrderStock.toasts.reserved",
        ),
      );
      changed(updated);
    } catch (error) {
      reportApiError(error, "storeOrderStock.errors.reserve");
    } finally {
      setBusy(false);
    }
  };

  const nextShipment = async () => {
    setBusy(true);
    try {
      await storeOrderStockApi.nextShipment(orderId);
      toast.success(t("storeOrderStock.toasts.nextShipment"));
      load();
      onChanged?.();
    } catch (error) {
      reportApiError(error, "storeOrderStock.errors.nextShipment");
    } finally {
      setBusy(false);
    }
  };

  if (!view) {
    return (
      <DetailSection title={t("storeOrderStock.title")}>
        <Skeleton className="h-20 w-full" />
      </DetailSection>
    );
  }

  const current = view.shipments.at(-1);
  const remaining = view.lines.some(
    (line) => line.stockLine && line.ordered - line.delivered - line.inTransit > 0,
  );
  const canNextShipment =
    view.active && current?.status === "DELIVERED" && remaining && hasPermission("shipping.edit");

  const actions = (
    <div className="flex flex-wrap items-center gap-1.5">
      <StockStatusChip status={view.stockStatus} />
      {view.canReserve && hasPermission("store-orders.edit") ? (
        <EnterpriseButton
          type="button"
          size="xs"
          onClick={() => void reserve()}
          disabled={busy}
          data-testid="stock-reserve-now"
        >
          <RefreshCw className="size-3.5" />
          {t(busy ? "storeOrderStock.actions.reserving" : "storeOrderStock.actions.reserve")}
        </EnterpriseButton>
      ) : null}
      {view.canReceiveBack && hasPermission("shipping.receive_returns") ? (
        <EnterpriseButton
          type="button"
          size="xs"
          variant="outline"
          onClick={() => setReceiving(true)}
          data-testid="stock-receive-back"
        >
          <PackageOpen className="size-3.5" />
          {t("storeOrderStock.actions.receiveBack")}
        </EnterpriseButton>
      ) : null}
      {canNextShipment ? (
        <EnterpriseButton
          type="button"
          size="xs"
          variant="outline"
          onClick={() => void nextShipment()}
          disabled={busy}
          data-testid="stock-next-shipment"
        >
          <PackagePlus className="size-3.5" />
          {t("storeOrderStock.actions.nextShipment")}
        </EnterpriseButton>
      ) : null}
    </div>
  );

  return (
    <DetailSection title={t("storeOrderStock.title")} actions={actions}>
      {view.stockIssue ? (
        <Alert tone="destructive" data-testid="stock-issue" data-code={view.stockIssue.code}>
          <AlertTriangle />
          <div className="flex min-w-0 flex-col gap-0.5">
            <AlertTitle>{t("storeOrderStock.issue.title")}</AlertTitle>
            <AlertDescription>
              {locale === "ar" ? view.stockIssue.messageAr : view.stockIssue.messageEn}
            </AlertDescription>
          </div>
        </Alert>
      ) : null}

      {/* Phones: one stacked card per line (the six figures never scroll sideways). */}
      <ul className="flex flex-col gap-2 sm:hidden" data-testid="stock-lines-stacked">
        {view.lines.map((line) => {
          const figures: Array<[string, ReactNode]> = [
            [t("storeOrderStock.columns.ordered"), line.ordered],
            ...(line.stockLine
              ? ([
                  [t("storeOrderStock.columns.reserved"), line.reserved],
                  [t("storeOrderStock.columns.inTransit"), line.inTransit],
                  [t("storeOrderStock.columns.delivered"), line.delivered],
                ] as Array<[string, ReactNode]>)
              : []),
            ...(line.returnedSaleable + line.returnedDamaged > 0
              ? ([
                  [
                    t("storeOrderStock.columns.returned"),
                    t("storeOrderStock.returnedSplit", {
                      saleable: line.returnedSaleable,
                      damaged: line.returnedDamaged,
                    }),
                  ],
                ] as Array<[string, ReactNode]>)
              : []),
            ...(line.short > 0
              ? ([
                  [
                    t("storeOrderStock.columns.short"),
                    <StatusBadge key="short" label={String(line.short)} tone="destructive" />,
                  ],
                ] as Array<[string, ReactNode]>)
              : []),
          ];
          return (
            <li key={line.storeOrderItemId} className="rounded-md border border-border px-3 py-2">
              <div className="flex min-w-0 flex-col">
                <span className="font-medium break-words">{line.name}</span>
                <span className="text-caption text-muted-foreground">
                  <span dir="ltr" className="font-mono">
                    {line.sku}
                  </span>
                  {line.stockLine && line.warehouse ? ` · ${line.warehouse.code}` : null}
                  {line.stockLine ? null : ` · ${t("storeOrderStock.nonStockLine")}`}
                </span>
              </div>
              <dl className="mt-1.5 grid grid-cols-3 gap-x-3 gap-y-1">
                {figures.map(([label, value]) => (
                  <div key={label} className="min-w-0">
                    <dt className="text-caption text-muted-foreground">{label}</dt>
                    <dd className="num text-body font-medium">{value}</dd>
                  </div>
                ))}
              </dl>
            </li>
          );
        })}
      </ul>

      <div className="hidden overflow-x-auto sm:block">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t("storeOrderStock.columns.product")}</TableHead>
              <TableHead className={tableNumericCellClass}>
                {t("storeOrderStock.columns.ordered")}
              </TableHead>
              <TableHead className={tableNumericCellClass}>
                {t("storeOrderStock.columns.reserved")}
              </TableHead>
              <TableHead className={tableNumericCellClass}>
                {t("storeOrderStock.columns.inTransit")}
              </TableHead>
              <TableHead className={tableNumericCellClass}>
                {t("storeOrderStock.columns.delivered")}
              </TableHead>
              <TableHead>{t("storeOrderStock.columns.returned")}</TableHead>
              <TableHead className={tableNumericCellClass}>
                {t("storeOrderStock.columns.short")}
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {view.lines.map((line) => (
              <TableRow key={line.storeOrderItemId}>
                <TableCell>
                  <div className="flex min-w-0 flex-col">
                    <span className="truncate font-medium">{line.name}</span>
                    <span className="text-caption text-muted-foreground">
                      <span dir="ltr" className="font-mono">
                        {line.sku}
                      </span>
                      {line.stockLine && line.warehouse ? ` · ${line.warehouse.code}` : null}
                      {line.stockLine ? null : ` · ${t("storeOrderStock.nonStockLine")}`}
                    </span>
                  </div>
                </TableCell>
                <TableCell numeric>{line.ordered}</TableCell>
                <TableCell numeric>{line.stockLine ? line.reserved : "—"}</TableCell>
                <TableCell numeric>{line.stockLine ? line.inTransit : "—"}</TableCell>
                <TableCell numeric>{line.stockLine ? line.delivered : "—"}</TableCell>
                <TableCell>
                  {line.returnedSaleable + line.returnedDamaged > 0
                    ? t("storeOrderStock.returnedSplit", {
                        saleable: line.returnedSaleable,
                        damaged: line.returnedDamaged,
                      })
                    : "—"}
                </TableCell>
                <TableCell numeric>
                  {line.short > 0 ? (
                    <StatusBadge label={String(line.short)} tone="destructive" />
                  ) : (
                    "—"
                  )}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      {view.postedCogs !== null ? (
        <p className="text-caption text-muted-foreground" data-testid="stock-posted-cogs">
          {t("storeOrderStock.costs.cogs")} — {t("storeOrderStock.costs.posted")}:{" "}
          <span className="num font-medium text-foreground">{formatAmount(view.postedCogs)}</span>
        </p>
      ) : null}

      {view.shipments.some((shipment) => shipment.lines.length > 0) ? (
        <div className="flex flex-col gap-1">
          <h3 className="text-caption font-semibold">{t("storeOrderStock.shipments.title")}</h3>
          <ul className="flex flex-col gap-0.5 text-caption text-muted-foreground">
            {view.shipments
              .filter((shipment) => shipment.lines.length > 0)
              .map((shipment) => (
                <li key={shipment.id} className="flex flex-col">
                  <span className="font-medium text-foreground">
                    {t("storeOrderStock.shipments.attempt", { number: shipment.attemptNumber })}
                    {shipment.isReship ? ` · ${t("storeOrderStock.shipments.reship")}` : null}
                  </span>
                  {shipment.lines.map((line) => (
                    <span key={line.id}>
                      {t("storeOrderStock.shipments.line", {
                        // An isolated code: "PRD-…: 2" would otherwise read as one run in Arabic.
                        sku: ltrIsolate(
                          view.lines.find((l) => l.storeOrderItemId === line.storeOrderItemId)
                            ?.sku ?? "",
                        ),
                        quantity: line.quantity,
                        delivered: line.deliveredQuantity,
                        returned: line.returnedQuantity,
                        withCarrier: line.withCarrier,
                      })}
                      {line.carried > 0
                        ? ` · ${t("storeOrderStock.shipments.carried", { count: line.carried })}`
                        : null}
                    </span>
                  ))}
                </li>
              ))}
          </ul>
        </div>
      ) : null}

      <CollapsibleDetailSection
        title={t("storeOrderStock.movements.title")}
        summary={t("storeOrderStock.movements.summary", { count: view.movements.length })}
        open={movementsOpen}
        onOpenChange={setMovementsOpen}
        testId="stock-movements"
      >
        {view.movements.length === 0 ? (
          <p className="text-caption text-muted-foreground">
            {t("storeOrderStock.movements.empty")}
          </p>
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t("storeOrderStock.movements.number")}</TableHead>
                  <TableHead>{t("storeOrderStock.movements.type")}</TableHead>
                  <TableHead>{t("storeOrderStock.movements.warehouse")}</TableHead>
                  <TableHead className={tableNumericCellClass}>
                    {t("storeOrderStock.movements.quantity")}
                  </TableHead>
                  <TableHead>{t("storeOrderStock.movements.date")}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {view.movements.map((movement) => (
                  <TableRow key={movement.id}>
                    <TableCell>
                      <span dir="ltr" className="font-mono text-caption">
                        {movement.movementNumber}
                      </span>
                      <span className="block text-caption text-muted-foreground" dir="ltr">
                        {movement.sku}
                      </span>
                    </TableCell>
                    <TableCell>
                      {t(`inventory.movementType.${movement.type}` as MessageKey)}
                    </TableCell>
                    <TableCell>
                      {movement.warehouse ? (
                        <span className="flex flex-wrap items-center gap-1">
                          <span dir="ltr" className="font-mono text-caption">
                            {movement.warehouse.code}
                          </span>
                          <WarehouseRoleBadge role={movement.warehouse.role} />
                        </span>
                      ) : (
                        "—"
                      )}
                    </TableCell>
                    <TableCell numeric>{movement.quantity}</TableCell>
                    <TableCell>{formatDateTime(movement.createdAt)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </CollapsibleDetailSection>

      {receiving ? (
        <ReceiveBackDialog
          view={view}
          open={receiving}
          onOpenChange={setReceiving}
          onReceived={changed}
        />
      ) : null}
    </DetailSection>
  );
}
