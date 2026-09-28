import { formatDate } from "@/lib/date";
import type { PackageSlipPayload, PrintCompanyInfo, SlipCollection } from "@/types/print-engine";
import type { FulfillmentGateResult, StoreOrderRow } from "@/services/store-orders-service";

const EPSILON = 0.005;
const round2 = (value: number) => Math.round(value * 100) / 100;

/** Canonical store-order line amount (mirrors the API's `storeOrderLineAmount`). */
export function slipLineAmount(item: {
  quantity: number;
  unitPrice: string;
  agreedAmount?: string | null;
}): number {
  if (item.agreedAmount != null && item.agreedAmount !== "") return Number(item.agreedAmount);
  return Number(item.quantity) * Number(item.unitPrice);
}

/**
 * What the courier / pickup desk must do about money — derived only from the
 * existing authorized rules (specs/print-design-system §4):
 *
 * - CASH_ON_DELIVERY: collect the order total minus what was already
 *   declared paid (standing PENDING / MATCHED / VERIFIED claims =
 *   `declaredAmount`), floored at zero; nothing to collect once fully
 *   declared — worded as "covered by declared payments" (`COD_SETTLED`), or
 *   as Finance-verified only when the order's Finance payment status is
 *   fully paid / overpaid.
 * - PREPAID: the server's fulfillment gate decides. Allowed (declared PAID in
 *   full, or Finance-verified) → no collection, stating which basis — a
 *   declaration is never presented as Finance verification. Not allowed
 *   (unpaid / partial) → hold: the slip never invents an amount to collect.
 *
 * The accounting balance (invoices, Finance matching) is never used here.
 */
export function resolveSlipCollection(
  order: Pick<StoreOrderRow, "paymentType" | "declaredAmount"> &
    Partial<Pick<StoreOrderRow, "paymentStatus">>,
  orderTotal: number,
  gate: Pick<FulfillmentGateResult, "allowed" | "basis">,
): SlipCollection {
  const total = round2(orderTotal);
  const declared = round2(Math.max(0, Number(order.declaredAmount ?? 0) || 0));
  if (order.paymentType === "CASH_ON_DELIVERY") {
    const due = round2(Math.max(0, total - declared));
    if (due <= EPSILON) {
      // Nothing left to collect. Finance verification (the same statuses the
      // server's fulfillment gate treats as verified) is stated as such; a
      // declaration alone is never presented as verified.
      const verified =
        order.paymentStatus === "FULLY_PAID_RECONCILED" || order.paymentStatus === "OVERPAID";
      return { kind: "none", basis: verified ? "VERIFIED_PAID" : "COD_SETTLED" };
    }
    return { kind: "collect", amount: due, orderTotal: total, declaredPaid: declared };
  }
  if (!gate.allowed) return { kind: "hold" };
  return {
    kind: "none",
    basis: gate.basis === "VERIFIED_PAID" ? "VERIFIED_PAID" : "DECLARED_PAID",
  };
}

/**
 * Store-order A5 package slip payload. Reads only what the order detail
 * already shows the user; prints a carrier tracking number only when the
 * carrier issued one on the current shipment attempt. Internal order notes
 * are never printed (the slip travels with the package).
 */
export function buildPackageSlipPayload(
  order: StoreOrderRow,
  gate: Pick<FulfillmentGateResult, "allowed" | "basis">,
  options: { company: PrintCompanyInfo; printedByName: string | null },
): PackageSlipPayload {
  const items = order.items ?? [];
  const orderTotal = items.reduce((sum, item) => sum + slipLineAmount(item), 0);
  const method = order.fulfillmentMethod === "PICKUP" ? "PICKUP" : "SHIPPING";
  // The current shipment attempt (a reshipment supersedes earlier attempts).
  const shipment = [...(order.shipments ?? [])].sort(
    (a, b) => b.attemptNumber - a.attemptNumber,
  )[0];
  const partner = order.partner;
  return {
    variant: "package-slip",
    printedByName: options.printedByName,
    company: options.company,
    orderNumber: order.internalOrderId,
    externalOrderId:
      order.externalOrderId && order.externalOrderId !== order.internalOrderId
        ? order.externalOrderId
        : undefined,
    orderDate: formatDate(order.orderDate),
    method,
    paymentType: order.paymentType,
    currency: order.currency?.code ?? "",
    customer: {
      name: partner?.name ?? "",
      phone: partner?.mobile || partner?.phone || undefined,
      addressLines: [partner?.address, partner?.city].filter(
        (value): value is string => !!value && value.trim() !== "",
      ),
    },
    items: items.map((item) => ({
      name: item.product?.name ?? "",
      sku: item.product?.sku ?? undefined,
      quantity: Number(item.quantity),
    })),
    collection: resolveSlipCollection(order, orderTotal, gate),
    carrier:
      method === "SHIPPING" && shipment && (shipment.trackingNumber || shipment.shippingCompany)
        ? {
            name: shipment.shippingCompany?.name,
            trackingNumber: shipment.trackingNumber ?? undefined,
          }
        : undefined,
    recordPath: `/store-orders/${order.id}`,
  };
}
