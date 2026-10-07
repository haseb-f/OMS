import { BadRequestException, HttpException } from '@nestjs/common';

/**
 * R14 W3 (spec-3 §3) — why a company store order could not be recognised
 * (or its stock reserved). Every code carries an Arabic + English message that
 * names the product / warehouse and the screen to fix it on; the same object
 * is stored on `StoreOrder.recognitionError`, logged on the order timeline and
 * returned by a manual retry, so the user is never left with a silent failure.
 */
export type RecognitionErrorCode =
  | 'MISSING_WAREHOUSE'
  | 'INSUFFICIENT_STOCK'
  | 'MISSING_COST'
  | 'MISSING_ACCOUNT_MAPPING'
  | 'INACTIVE_PRODUCT'
  | 'KIT_RECIPE'
  | 'AGENT_OWNED_PRODUCT'
  | 'RECOGNITION_ERROR';

/** Which step failed: the shipment-time reservation or the delivery-time recognition. */
export type RecognitionStage = 'RESERVATION' | 'RECOGNITION';

export interface RecognitionIssue {
  code: RecognitionErrorCode;
  messageAr: string;
  messageEn: string;
  productId?: string;
  productSku?: string;
  warehouseId?: string;
}

/** The JSON stored on `StoreOrder.recognitionError`. */
export interface RecognitionErrorRecord extends RecognitionIssue {
  stage: RecognitionStage;
  /** Every blocker found by the preflight (the first one is repeated above). */
  issues: RecognitionIssue[];
  at: string;
}

const sku = (value?: string) => value ?? '—';

export const recognitionIssue = {
  missingWarehouse(productSku?: string, productId?: string): RecognitionIssue {
    return {
      code: 'MISSING_WAREHOUSE',
      productSku,
      productId,
      messageAr: `لا يوجد مستودع نشط لصرف المنتج ${sku(productSku)}. حدّد المستودع المفضّل للمنتج (المنتجات) أو فعّل مستودعاً افتراضياً (المخزون ← المستودعات) ثم أعد المحاولة.`,
      messageEn: `No active warehouse to issue ${sku(productSku)} from. Set the product's preferred warehouse (Products) or activate a default warehouse (Inventory → Warehouses), then retry.`,
    };
  },
  insufficientStock(input: {
    productSku?: string;
    productId?: string;
    warehouseId?: string;
    warehouseCode?: string;
    available: number;
    required: number;
  }): RecognitionIssue {
    const where = input.warehouseCode ?? '—';
    return {
      code: 'INSUFFICIENT_STOCK',
      productSku: input.productSku,
      productId: input.productId,
      warehouseId: input.warehouseId,
      messageAr: `الرصيد المتاح من ${sku(input.productSku)} في المستودع ${where} غير كافٍ (المتاح ${input.available}، المطلوب ${input.required}). سجّل فاتورة مشتريات أو تسوية مخزون (المخزون) ثم أعد المحاولة.`,
      messageEn: `Not enough available stock of ${sku(input.productSku)} at warehouse ${where} (available ${input.available}, required ${input.required}). Record a purchase invoice or an inventory adjustment (Inventory), then retry.`,
    };
  },
  missingCost(productSku?: string, productId?: string): RecognitionIssue {
    return {
      code: 'MISSING_COST',
      productSku,
      productId,
      messageAr: `المنتج ${sku(productSku)} ليس له تكلفة مسجّلة، ولا تُرحَّل تكلفة البضاعة المباعة بصفر. سجّل تكلفة المنتج أو رصيداً افتتاحياً (المخزون ← تكلفة المنتج) ثم أعد المحاولة.`,
      messageEn: `Product ${sku(productSku)} has no recorded cost — COGS is never posted as zero. Record a product cost or an opening balance (Inventory → Product cost), then retry.`,
    };
  },
  missingMapping(detail: string): RecognitionIssue {
    return {
      code: 'MISSING_ACCOUNT_MAPPING',
      messageAr: `إعداد الحسابات غير مكتمل (${detail}). أكمل ربط الحسابات (الإعدادات ← المحاسبة) أو حسابات فئة المنتج ثم أعد المحاولة.`,
      messageEn: `Account mapping is incomplete (${detail}). Complete it in Settings → Accounting or on the product category, then retry.`,
    };
  },
  inactiveProduct(productSku?: string, productId?: string): RecognitionIssue {
    return {
      code: 'INACTIVE_PRODUCT',
      productSku,
      productId,
      messageAr: `المنتج ${sku(productSku)} غير نشط أو مؤرشف. أعد تفعيله (المنتجات) ثم أعد المحاولة.`,
      messageEn: `Product ${sku(productSku)} is inactive or archived. Reactivate it (Products), then retry.`,
    };
  },
  kitRecipe(detail: string, productSku?: string, productId?: string) {
    return {
      code: 'KIT_RECIPE',
      productSku,
      productId,
      messageAr: `تعذّر تفكيك الطقم ${sku(productSku)} إلى مكوّناته (${detail}). فعّل وصفة صحيحة للطقم (المنتجات ← الوصفات) ثم أعد المحاولة.`,
      messageEn: `Kit ${sku(productSku)} could not be resolved into its components (${detail}). Activate a valid recipe (Products → Recipes), then retry.`,
    } satisfies RecognitionIssue;
  },
  agentOwned(productSku?: string, productId?: string): RecognitionIssue {
    return {
      code: 'AGENT_OWNED_PRODUCT',
      productSku,
      productId,
      messageAr: `المنتج ${sku(productSku)} مملوك لوكيل ولا يُباع على طلب للشركة. صحّح بنود الطلب ثم أعد المحاولة.`,
      messageEn: `Product ${sku(productSku)} is agent-owned and cannot be sold on a company order. Correct the order lines, then retry.`,
    };
  },
  unexpected(detail: string): RecognitionIssue {
    return {
      code: 'RECOGNITION_ERROR',
      messageAr: `تعذّر إثبات البيع: ${detail}`,
      messageEn: `Recognition failed: ${detail}`,
    };
  },
};

/** The plain message (and code) of any thrown error, Nest or not. */
export function errorText(error: unknown): { message: string; code?: string } {
  if (error instanceof HttpException) {
    const body = error.getResponse();
    if (typeof body === 'string') return { message: body };
    const fields = body as { code?: unknown; message?: unknown };
    const message = Array.isArray(fields.message)
      ? fields.message.join('; ')
      : typeof fields.message === 'string'
        ? fields.message
        : error.message;
    return {
      message,
      code: typeof fields.code === 'string' ? fields.code : undefined,
    };
  }
  return { message: error instanceof Error ? error.message : String(error) };
}

/**
 * Maps an error thrown while writing (the preflight normally catches these
 * first) onto an actionable issue. Unknown errors keep their own text.
 */
export function classifyRecognitionError(error: unknown): RecognitionIssue {
  const { message, code } = errorText(error);
  if (
    code === 'INVENTORY_AVAILABLE_INSUFFICIENT' ||
    /exceeds (the available|on-hand) stock|Cannot reserve/i.test(message)
  ) {
    return {
      ...recognitionIssue.insufficientStock({ available: 0, required: 0 }),
      messageAr: `الرصيد المتاح غير كافٍ: ${message}`,
      messageEn: `Not enough available stock: ${message}`,
    };
  }
  if (/no recorded cost/i.test(message)) {
    return {
      ...recognitionIssue.missingCost(),
      messageAr: `تكلفة منتج غير مسجّلة: ${message}`,
      messageEn: message,
    };
  }
  if (/account configured|account is configured/i.test(message)) {
    return recognitionIssue.missingMapping(message);
  }
  if (code?.startsWith('KIT_')) return recognitionIssue.kitRecipe(message);
  if (/Product is inactive/i.test(message)) {
    return recognitionIssue.inactiveProduct();
  }
  if (/Warehouse/i.test(message) && /inactive|No active/i.test(message)) {
    return recognitionIssue.missingWarehouse();
  }
  return recognitionIssue.unexpected(message);
}

/** The 4xx a manual retry answers with — `{ code, message, messageAr, messageEn, issues }`. */
export function recognitionException(issues: RecognitionIssue[]) {
  const [first] = issues;
  return new BadRequestException({
    code: first.code,
    message: `${first.messageAr} — ${first.messageEn}`,
    messageAr: first.messageAr,
    messageEn: first.messageEn,
    issues,
  });
}
