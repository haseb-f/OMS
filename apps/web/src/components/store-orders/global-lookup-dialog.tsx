"use client";

import { useState } from "react";
import { Loader2, Phone, Search, UserCheck } from "lucide-react";
import { EnterpriseButton } from "@/components/ui/button";
import { EnterpriseBadge } from "@/components/ui/badge";
import { EnterpriseModal } from "@/components/shared/enterprise-modal";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { InputGroup, InputGroupAddon, InputGroupInput } from "@/components/ui/input-group";
import { FieldLabel } from "@/components/ui/form";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { partnersService, type CustomerGlobalLookupResult } from "@/services/partners-service";
import {
  storeOrdersService,
  type OrderGlobalLookupResult,
  type StoreOrderPaymentStatusValue,
  type StoreOrderShippingStageValue,
} from "@/services/store-orders-service";
import { PAYMENT_STATUS_LABEL_KEY, SHIPPING_STAGE_LABEL_KEY } from "@/config/store-orders/status";
import { useLocale } from "@/providers/locale-provider";
import { useUserContext } from "@/providers/user-context";
import { formatDate } from "@/lib/date";
import type { StoreOrderCreatePrefillCustomer } from "./store-order-create-dialog";

type LookupMethod = "phone" | "order";
type LookupState = "idle" | "loading" | "customer-found" | "order-found" | "not-found" | "error";

/**
 * Explicit, distinct action from ordinary Orders/Leads table search
 * (spec: "Explicit Global Lookup" must never silently merge with generic
 * table search). Exact-match only, gated by `customers.lookup_global` /
 * `orders.lookup_global` — never grants a full Customer/Order directory
 * browse.
 */
export function GlobalLookupDialog({
  open,
  onOpenChange,
  onAddNewOrder,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Opens the Create Order dialog pre-filled with the found Customer. `null` hides the CTA for a caller without `store-orders.create`. */
  onAddNewOrder: ((customer: StoreOrderCreatePrefillCustomer) => void) | null;
}) {
  const { t } = useLocale();
  const { hasPermission } = useUserContext();
  const canLookupCustomer = hasPermission("customers.lookup_global");
  const canLookupOrder = hasPermission("orders.lookup_global");

  const [method, setMethod] = useState<LookupMethod>(canLookupCustomer ? "phone" : "order");
  const [query, setQuery] = useState("");
  const [state, setState] = useState<LookupState>("idle");
  const [customerResult, setCustomerResult] = useState<CustomerGlobalLookupResult | null>(null);
  const [orderResult, setOrderResult] = useState<OrderGlobalLookupResult | null>(null);

  const reset = () => {
    setQuery("");
    setState("idle");
    setCustomerResult(null);
    setOrderResult(null);
  };

  const search = async () => {
    const value = query.trim();
    if (!value) return;
    setState("loading");
    try {
      if (method === "phone") {
        const result = await partnersService.globalLookupByPhone(value);
        setCustomerResult(result);
        setOrderResult(null);
        setState(result ? "customer-found" : "not-found");
      } else {
        const result = await storeOrdersService.globalLookupByOrderNumber(value);
        setOrderResult(result);
        setCustomerResult(null);
        setState(result ? "order-found" : "not-found");
      }
    } catch {
      setState("error");
    }
  };

  return (
    <EnterpriseModal
      open={open}
      onOpenChange={(next) => {
        if (!next) reset();
        onOpenChange(next);
      }}
      size="md"
      title={t("storeOrders.globalLookup.title")}
      description={t("storeOrders.globalLookup.description")}
      footer={(requestClose) => (
        <EnterpriseButton type="button" variant="outline" onClick={requestClose}>
          {t("common.close")}
        </EnterpriseButton>
      )}
    >
      <div className="flex flex-col gap-4">
        {canLookupCustomer && canLookupOrder && (
          <Tabs
            value={method}
            onValueChange={(value) => {
              setMethod(value as LookupMethod);
              reset();
            }}
          >
            <TabsList>
              <TabsTrigger value="phone">{t("storeOrders.globalLookup.methodPhone")}</TabsTrigger>
              <TabsTrigger value="order">{t("storeOrders.globalLookup.methodOrder")}</TabsTrigger>
            </TabsList>
          </Tabs>
        )}

        <div className="flex flex-col gap-1.5">
          <FieldLabel>
            {method === "phone"
              ? t("storeOrders.globalLookup.methodPhone")
              : t("storeOrders.globalLookup.methodOrder")}
          </FieldLabel>
          <div className="flex gap-2">
            <InputGroup className="flex-1">
              <InputGroupAddon>
                <Search />
              </InputGroupAddon>
              <InputGroupInput
                dir="ltr"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") void search();
                }}
                placeholder={
                  method === "phone"
                    ? t("storeOrders.globalLookup.phonePlaceholder")
                    : t("storeOrders.globalLookup.orderPlaceholder")
                }
              />
            </InputGroup>
            <EnterpriseButton
              type="button"
              onClick={() => void search()}
              disabled={state === "loading" || !query.trim()}
              className="gap-1.5"
            >
              {state === "loading" ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <Search className="size-4" />
              )}
              {t("storeOrders.globalLookup.search")}
            </EnterpriseButton>
          </div>
        </div>

        {state === "error" && (
          <p className="text-sm text-destructive">{t("storeOrders.globalLookup.error")}</p>
        )}
        {state === "not-found" && (
          <p className="text-sm text-muted-foreground">
            {method === "phone"
              ? t("storeOrders.globalLookup.notFoundCustomer")
              : t("storeOrders.globalLookup.notFoundOrder")}
          </p>
        )}

        {state === "customer-found" && customerResult && (
          <div className="flex flex-col gap-3 rounded-md border border-border p-3">
            <div className="flex flex-wrap items-center gap-2">
              <EnterpriseBadge variant="info" className="gap-1">
                <UserCheck className="size-3.5" />
                {customerResult.name}
              </EnterpriseBadge>
              <span dir="ltr" className="flex items-center gap-1 text-xs text-muted-foreground">
                <Phone className="size-3.5" />
                {customerResult.phone || customerResult.mobile}
              </span>
            </div>
            <div className="grid grid-cols-2 gap-2 text-sm">
              <div>
                <div className="text-xs text-muted-foreground">
                  {t("storeOrders.globalLookup.customer.totalOrders")}
                </div>
                <div className="font-medium">{customerResult.totalOrders}</div>
              </div>
              <div>
                <div className="text-xs text-muted-foreground">
                  {t("storeOrders.globalLookup.customer.lastOrderDate")}
                </div>
                <div className="font-medium">
                  {customerResult.lastOrder ? formatDate(customerResult.lastOrder.orderDate) : "—"}
                </div>
              </div>
            </div>
            {customerResult.recentOrders.length > 0 && (
              <div className="flex flex-col gap-1.5">
                <div className="text-xs text-muted-foreground">
                  {t("storeOrders.globalLookup.customer.recentOrders")}
                </div>
                <div className="overflow-x-auto rounded-md border border-border">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>{t("storeOrders.fields.internalOrderId")}</TableHead>
                        <TableHead>{t("storeOrders.fields.orderDate")}</TableHead>
                        <TableHead>{t("storeOrders.fields.product")}</TableHead>
                        <TableHead>{t("storeOrders.fields.paymentStatus")}</TableHead>
                        <TableHead>{t("storeOrders.fields.shippingStage")}</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {customerResult.recentOrders.map((order) => (
                        <TableRow key={order.id}>
                          <TableCell dir="ltr">{order.orderNumber}</TableCell>
                          <TableCell>{formatDate(order.orderDate)}</TableCell>
                          <TableCell className="max-w-40 truncate" title={order.products}>
                            {order.products || "—"}
                          </TableCell>
                          <TableCell>
                            {t(
                              PAYMENT_STATUS_LABEL_KEY[
                                order.paymentStatus as StoreOrderPaymentStatusValue
                              ],
                            )}
                          </TableCell>
                          <TableCell>
                            {t(
                              SHIPPING_STAGE_LABEL_KEY[
                                order.shippingStage as StoreOrderShippingStageValue
                              ],
                            )}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              </div>
            )}
            {onAddNewOrder && (
              <EnterpriseButton
                type="button"
                className="w-fit gap-1.5"
                onClick={() => {
                  onAddNewOrder({
                    name: customerResult.name,
                    phone: customerResult.phone || customerResult.mobile,
                    countryId: customerResult.countryId,
                    city: customerResult.city,
                    address: customerResult.address,
                  });
                  onOpenChange(false);
                }}
              >
                {t("storeOrders.globalLookup.customer.addNewOrder")}
              </EnterpriseButton>
            )}
          </div>
        )}

        {state === "order-found" && orderResult && (
          <div className="flex flex-col gap-2 rounded-md border border-border p-3">
            <div className="flex flex-wrap items-center gap-2">
              <EnterpriseBadge variant="secondary" dir="ltr">
                {orderResult.orderNumber}
              </EnterpriseBadge>
              <span className="text-sm font-medium">{orderResult.customerName}</span>
              {orderResult.customerPhone && (
                <span dir="ltr" className="text-xs text-muted-foreground">
                  {orderResult.customerPhone}
                </span>
              )}
            </div>
            <div className="grid grid-cols-2 gap-2 text-sm">
              <div>
                <div className="text-xs text-muted-foreground">
                  {t("storeOrders.globalLookup.order.orderDate")}
                </div>
                <div className="font-medium">{formatDate(orderResult.orderDate)}</div>
              </div>
              <div>
                <div className="text-xs text-muted-foreground">
                  {t("storeOrders.globalLookup.order.products")}
                </div>
                <div className="font-medium">{orderResult.products || "—"}</div>
              </div>
              <div>
                <div className="text-xs text-muted-foreground">
                  {t("storeOrders.globalLookup.order.paymentStatus")}
                </div>
                <div className="font-medium">
                  {t(
                    PAYMENT_STATUS_LABEL_KEY[
                      orderResult.paymentStatus as StoreOrderPaymentStatusValue
                    ],
                  )}
                </div>
              </div>
              <div>
                <div className="text-xs text-muted-foreground">
                  {t("storeOrders.globalLookup.order.shippingStatus")}
                </div>
                <div className="font-medium">
                  {t(
                    SHIPPING_STAGE_LABEL_KEY[
                      orderResult.shippingStage as StoreOrderShippingStageValue
                    ],
                  )}
                </div>
              </div>
            </div>
            <p className="text-xs text-muted-foreground">
              {t("storeOrders.globalLookup.order.readOnlyNotice")}
            </p>
          </div>
        )}
      </div>
    </EnterpriseModal>
  );
}
