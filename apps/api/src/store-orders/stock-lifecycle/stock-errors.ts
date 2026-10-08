import {
  BadRequestException,
  ConflictException,
  UnprocessableEntityException,
} from '@nestjs/common';

/**
 * R15 W5a — every refusal / shortage of the stock lifecycle carries a code
 * and an Arabic + English message naming the product and what to do, like
 * the R14 recognition errors (`recognition-errors.ts`).
 */
export interface StockShortLine {
  storeOrderItemId: string;
  productId: string;
  sku: string;
  /** Set when the short product is a component of the line's kit. */
  kitSku?: string;
  warehouseId: string;
  warehouseCode: string | null;
  required: number;
  available: number;
}

/** The JSON stored on `StoreOrder.stockIssue`. */
export interface StockIssueRecord {
  code: 'INSUFFICIENT_STOCK';
  messageAr: string;
  messageEn: string;
  lines: StockShortLine[];
  at: string;
}

const skuOf = (line: StockShortLine) =>
  line.kitSku ? `${line.sku} (${line.kitSku})` : line.sku;

const describeAr = (lines: StockShortLine[]) =>
  lines
    .map(
      (line) =>
        `${skuOf(line)} في ${line.warehouseCode ?? '—'}: المطلوب ${line.required}، المتاح ${Math.max(line.available, 0)}`,
    )
    .join('، ');

const describeEn = (lines: StockShortLine[]) =>
  lines
    .map(
      (line) =>
        `${skuOf(line)} at ${line.warehouseCode ?? '—'}: required ${line.required}, available ${Math.max(line.available, 0)}`,
    )
    .join('; ');

export function insufficientStockIssue(
  lines: StockShortLine[],
): StockIssueRecord {
  return {
    code: 'INSUFFICIENT_STOCK',
    messageAr: `لم يُحجز المخزون لبعض البنود لعدم كفاية الرصيد المتاح (${describeAr(lines)}). سجّل الاستلام أو التسوية ثم اضغط «احجز الآن».`,
    messageEn: `Some lines are not reserved — not enough available stock (${describeEn(lines)}). Receive or adjust the stock, then use "Reserve now".`,
    lines,
    at: new Date().toISOString(),
  };
}

/** Dispatch of a line with nothing reserved (and nothing with the carrier) is refused. */
export function stockNotReserved(lines: StockShortLine[]) {
  return new UnprocessableEntityException({
    code: 'STOCK_NOT_RESERVED',
    message: `لا يمكن الشحن — المخزون غير محجوز (${describeAr(lines)}) — Cannot dispatch: stock is not reserved (${describeEn(lines)}).`,
    messageAr: `لا يمكن تسجيل الشحن لأن المخزون غير محجوز: ${describeAr(lines)}. استلم البضاعة أو احجزها ثم أعد المحاولة.`,
    messageEn: `The shipment cannot leave: stock is not reserved for ${describeEn(lines)}. Receive or reserve the stock, then retry.`,
    lines,
  });
}

export function nothingToDispatch() {
  return new UnprocessableEntityException({
    code: 'NOTHING_TO_DISPATCH',
    message:
      'لا توجد كميات متبقية للشحن — كل الكميات سُلّمت أو مع شركة الشحن — Nothing left to dispatch: every quantity is delivered or with the carrier.',
    messageAr:
      'لا توجد كميات متبقية للشحن — كل الكميات سُلّمت أو مع شركة الشحن.',
    messageEn:
      'Nothing left to dispatch: every quantity is delivered or with the carrier.',
  });
}

export function stockBadRequest(
  code: string,
  messageAr: string,
  messageEn: string,
) {
  return new BadRequestException({
    code,
    message: `${messageAr} — ${messageEn}`,
    messageAr,
    messageEn,
  });
}

export function stockConflict(
  code: string,
  messageAr: string,
  messageEn: string,
) {
  return new ConflictException({
    code,
    message: `${messageAr} — ${messageEn}`,
    messageAr,
    messageEn,
  });
}

export const stockErrors = {
  agentShipsWhole: () =>
    stockBadRequest(
      'AGENT_ORDER_SHIPS_WHOLE',
      'طلبات الوكلاء تُشحن كاملة — لا يمكن اختيار كميات جزئية',
      'Agent orders ship whole — quantities cannot be selected.',
    ),
  lineNotOnOrder: () =>
    stockBadRequest(
      'STOCK_LINE_INVALID',
      'البند غير موجود في الطلب أو مكرر أو لا يحرّك مخزوناً',
      'A line is not on this order, is repeated, or moves no stock.',
    ),
  quantityInvalid: () =>
    stockBadRequest(
      'STOCK_QUANTITY_INVALID',
      'الكمية يجب أن تكون عدداً صحيحاً غير سالب',
      'Quantities must be whole numbers, zero or more.',
    ),
  mustCarry: (sku: string, carried: number) =>
    stockBadRequest(
      'RESHIPMENT_MUST_CARRY',
      `إعادة الشحن تحمل ${carried} من ${sku} الموجودة لدى شركة الشحن — استلمها أولاً إن لم تُشحن مجدداً`,
      `The reshipment carries the ${carried} × ${sku} still with the carrier — receive them back first if they are not reshipped.`,
    ),
  kitRecipeChanged: (sku: string, carried: number) =>
    stockBadRequest(
      'KIT_RECIPE_CHANGED_IN_TRANSIT',
      `وصفة الطقم ${sku} تغيّرت منذ شحن ${carried} منه — أعد شحن الوحدات المحمولة وحدها أو استلمها أولاً`,
      `The recipe of kit ${sku} changed since ${carried} were dispatched — reship the carried units alone, or receive them back first.`,
    ),
  acceptedExceedsShipped: (sku: string, shipped: number) =>
    stockBadRequest(
      'DELIVERED_EXCEEDS_SHIPPED',
      `الكمية المستلمة من ${sku} تتجاوز المشحون (${shipped})`,
      `Accepted quantity of ${sku} exceeds what this shipment carried (${shipped}).`,
    ),
  acceptedExceedsOrdered: (sku: string, due: number) =>
    stockBadRequest(
      'DELIVERED_EXCEEDS_ORDERED',
      `الكمية المستلمة من ${sku} تتجاوز المتبقي للتسليم في الطلب (${due}) — استلم الزيادة مرتجعاً من شركة الشحن`,
      `Accepted quantity of ${sku} exceeds what the order still has to deliver (${due}) — receive the excess back from the carrier.`,
    ),
  nothingAccepted: () =>
    stockBadRequest(
      'NOTHING_ACCEPTED',
      'لم يستلم العميل أي كمية — سجّل «فشل التسليم» بدلاً من «تم التسليم»',
      'The customer accepted nothing — record a failed delivery instead.',
    ),
  receiveExceedsTransit: (sku: string, inTransit: number) =>
    stockBadRequest(
      'RECEIVE_EXCEEDS_IN_TRANSIT',
      `الكمية المستلمة من ${sku} تتجاوز الكمية لدى شركة الشحن (${inTransit})`,
      `Received quantity of ${sku} exceeds what is with the carrier (${inTransit}).`,
    ),
  warehouseRole: (expected: 'STOCK' | 'DAMAGED') =>
    stockBadRequest(
      'RECEIVE_WAREHOUSE_INVALID',
      expected === 'STOCK'
        ? 'البضاعة السليمة تُستلم في مستودع مخزون نشط'
        : 'البضاعة التالفة تُستلم في مستودع التالف',
      expected === 'STOCK'
        ? 'Saleable goods are received into an active stock warehouse.'
        : 'Damaged goods are received into a damaged-goods warehouse.',
    ),
  systemWarehouseMissing: (role: 'TRANSIT' | 'DAMAGED') =>
    stockConflict(
      'SYSTEM_WAREHOUSE_MISSING',
      role === 'TRANSIT'
        ? 'مستودع البضاعة في الطريق غير معرّف أو غير نشط (المخزون ← المستودعات)'
        : 'مستودع البضاعة التالفة غير معرّف أو غير نشط (المخزون ← المستودعات)',
      `The ${role === 'TRANSIT' ? 'goods-in-transit' : 'damaged-goods'} system warehouse is missing or inactive (Inventory → Warehouses).`,
    ),
  transitShort: (sku: string, held: number, needed: number) =>
    stockConflict(
      'TRANSIT_BALANCE_SHORT',
      `البضاعة في الطريق لهذا الطلب من ${sku} (${held}) أقل من المطلوب (${needed}) — راجع حركات الطلب (ربما تغيّرت وصفة الطقم بعد الشحن)`,
      `This order holds ${held} × ${sku} in transit, ${needed} needed — check the order's movements (a kit recipe may have changed since dispatch).`,
    ),
  goodsInTransit: (units: number) =>
    stockConflict(
      'GOODS_IN_TRANSIT',
      `${units} وحدة من بضاعة هذا الطلب ما زالت لدى شركة الشحن — استلمها أولاً («استلام البضاعة المرتجعة») قبل التسليم من الفرع`,
      `${units} unit(s) of this order are still with the carrier — receive them back first ("Receive returned goods") before the customer collects at the branch.`,
    ),
  agentUseReturnReceipt: () =>
    stockBadRequest(
      'AGENT_ORDER_USE_RETURN_RECEIPT',
      'مرتجعات طلبات الوكلاء تُستلم من «استلام مرتجع الوكيل»',
      'Agent orders are received back through the agent return receipt.',
    ),
  idempotencyKeyRequired: () =>
    stockBadRequest(
      'IDEMPOTENCY_KEY_REQUIRED',
      'مفتاح منع التكرار مطلوب',
      'An idempotency key is required.',
    ),
};
