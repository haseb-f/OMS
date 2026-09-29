import { Injectable } from '@nestjs/common';
import { Prisma, type AgentAgreement } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import {
  agentConflict,
  agentNotFoundError,
  agentUnprocessable,
} from '../common/agent-errors';
import { toDateOnly } from '../admin/agents.service';
import {
  AgentCommissionRateMissingError,
  AgentItemTypeMissingError,
  commissionExample,
  resolveLineCommissionRate,
  type AgentLineCommissionRate,
  type AgentRateOverride,
} from './agent-commission';

type Client = Prisma.TransactionClient | PrismaService;

const DAY_MS = 24 * 60 * 60 * 1000;

/** Owner's shipping example (commission-policy.md A1) — preview defaults. */
export const COMMISSION_EXAMPLE_DEFAULTS = {
  productSales: 1_000,
  serviceSales: 0,
  customerShipping: 100,
} as const;

export interface SetCommissionSettingInput {
  source: 'INHERIT' | 'OVERRIDE';
  ratePercent?: number;
  effectiveFrom: string;
  reason?: string;
}

/** Overrides whose inclusive [effectiveFrom, effectiveTo|∞] contains `day`. */
function inForceWhere(
  day: Date,
): Prisma.AgentProductCommissionOverrideWhereInput {
  return {
    effectiveFrom: { lte: day },
    OR: [{ effectiveTo: null }, { effectiveTo: { gte: day } }],
  };
}

/**
 * Item-level commission overrides and rate resolution
 * (commission-policy.md A3–A4). Overrides are effective-dated history:
 * a new setting closes the open row the day before it starts; rows are
 * never deleted and past ranges never change.
 */
@Injectable()
export class AgentCommissionRatesService {
  constructor(private readonly prisma: PrismaService) {}

  /** The override in force for each product on `date` (products without one are absent). */
  async overridesInForce(
    agentId: string,
    productIds: string[],
    date: Date,
    client: Client = this.prisma,
  ): Promise<Map<string, AgentRateOverride>> {
    if (productIds.length === 0) return new Map();
    // An override belongs to the agent that owned the product when it was
    // set — it never follows the product to another owner.
    const rows = await client.agentProductCommissionOverride.findMany({
      where: {
        agentId,
        productId: { in: productIds },
        ...inForceWhere(toDateOnly(date)),
      },
      orderBy: { effectiveFrom: 'desc' },
    });
    const map = new Map<string, AgentRateOverride>();
    for (const row of rows) {
      if (!map.has(row.productId)) {
        map.set(row.productId, {
          id: row.id,
          ratePercent: Number(row.ratePercent),
        });
      }
    }
    return map;
  }

  /**
   * Per-line rates at order submission. Throws AgentCommissionRateMissingError
   * (surfaced as a 422) instead of ever defaulting to 0%.
   */
  async resolveLineRates(
    agreement: Pick<
      AgentAgreement,
      | 'agentId'
      | 'productCommissionRatePercent'
      | 'serviceCommissionRatePercent'
    >,
    lines: Array<{ productId: string; itemType: 'PRODUCT' | 'SERVICE' | null }>,
    date: Date,
    client: Client = this.prisma,
  ): Promise<AgentLineCommissionRate[]> {
    const overrides = await this.overridesInForce(
      agreement.agentId,
      [...new Set(lines.map((line) => line.productId))],
      date,
      client,
    );
    return lines.map((line) =>
      resolveLineCommissionRate({
        productId: line.productId,
        itemType: line.itemType,
        agreement: {
          productCommissionRatePercent: Number(
            agreement.productCommissionRatePercent,
          ),
          serviceCommissionRatePercent: Number(
            agreement.serviceCommissionRatePercent,
          ),
        },
        override: overrides.get(line.productId) ?? null,
      }),
    );
  }

  // ── Product commission setting (Products screen) ─────────────────────────

  async productSetting(productId: string) {
    const product = await this.prisma.product.findFirst({
      where: { id: productId, deletedAt: null },
      select: {
        id: true,
        sku: true,
        name: true,
        isInventoryItem: true,
        itemType: true,
        ownerAgentId: true,
        ownerAgent: { select: { id: true, name: true, agentNumber: true } },
      },
    });
    if (!product) throw agentNotFoundError('Product', 'المنتج');
    const today = new Date();
    const [history, inForce] = await Promise.all([
      this.prisma.agentProductCommissionOverride.findMany({
        where: { productId, agentId: product.ownerAgentId ?? undefined },
        orderBy: [{ effectiveFrom: 'desc' }, { createdAt: 'desc' }],
      }),
      product.ownerAgentId
        ? this.overridesInForce(product.ownerAgentId, [productId], today)
        : Promise.resolve(new Map<string, AgentRateOverride>()),
    ]);
    const current = inForce.get(productId) ?? null;
    return {
      productId: product.id,
      ownership: product.ownerAgentId ? 'AGENT' : 'COMPANY',
      ownerAgent: product.ownerAgent,
      // A2: the explicit item type (null = not classified yet — needs review).
      commissionClass: product.itemType,
      source: current ? 'OVERRIDE' : 'INHERIT',
      overrideRatePercent: current?.ratePercent ?? null,
      history: history.map((row) => ({
        id: row.id,
        ratePercent: Number(row.ratePercent),
        effectiveFrom: row.effectiveFrom,
        effectiveTo: row.effectiveTo,
        reason: row.reason,
        createdAt: row.createdAt,
      })),
    };
  }

  /**
   * Sets "inherit" or an explicit override from `effectiveFrom` on. The open
   * override (if any) is closed the day before; a start on or before an
   * existing row's start is refused (history is never rewritten).
   */
  async setProductSetting(
    productId: string,
    input: SetCommissionSettingInput,
    userId: string,
  ) {
    const from = toDateOnly(input.effectiveFrom);
    if (Number.isNaN(from.getTime())) {
      throw agentUnprocessable(
        'COMMISSION_EFFECTIVE_FROM_INVALID',
        'تاريخ السريان غير صالح',
        'The effective date is invalid.',
      );
    }
    if (from < toDateOnly(new Date())) {
      throw agentUnprocessable(
        'COMMISSION_EFFECTIVE_FROM_PAST',
        'لا يمكن أن يبدأ الإعداد في الماضي — الطلبات السابقة احتفظت بنسبها',
        'A setting cannot start in the past — earlier orders already kept their rates.',
      );
    }
    if (input.source === 'OVERRIDE') {
      const rate = Number(input.ratePercent);
      if (
        input.ratePercent == null ||
        !Number.isFinite(rate) ||
        rate < 0 ||
        rate > 100
      ) {
        throw agentUnprocessable(
          'COMMISSION_OVERRIDE_RATE_REQUIRED',
          'أدخل نسبة العمولة للصنف (0 إلى 100، والصفر مسموح)',
          'Enter the item commission rate (0–100; 0% is allowed).',
        );
      }
    }
    await this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM products WHERE id = ${productId}::uuid FOR UPDATE`;
      const product = await tx.product.findFirst({
        where: { id: productId, deletedAt: null },
        select: { id: true, ownerAgentId: true },
      });
      if (!product) throw agentNotFoundError('Product', 'المنتج');
      if (!product.ownerAgentId) {
        throw agentUnprocessable(
          'COMMISSION_OVERRIDE_COMPANY_PRODUCT',
          'نسبة العمولة الخاصة تخص منتجات الوكلاء فقط',
          'Item commission overrides apply to agent-owned products only.',
        );
      }
      const later = await tx.agentProductCommissionOverride.findFirst({
        where: {
          productId,
          agentId: product.ownerAgentId,
          effectiveFrom: { gte: from },
        },
        select: { effectiveFrom: true },
      });
      if (later) {
        throw agentConflict(
          'COMMISSION_OVERRIDE_HISTORY_LOCKED',
          'يوجد إعداد يبدأ في هذا التاريخ أو بعده — اختر تاريخًا لاحقًا',
          'A setting already starts on or after this date — choose a later date (history is never rewritten).',
        );
      }
      const open = await tx.agentProductCommissionOverride.findFirst({
        where: {
          productId,
          agentId: product.ownerAgentId,
          OR: [{ effectiveTo: null }, { effectiveTo: { gte: from } }],
        },
        orderBy: { effectiveFrom: 'desc' },
      });
      if (open) {
        await tx.agentProductCommissionOverride.update({
          where: { id: open.id },
          data: {
            effectiveTo: new Date(from.getTime() - DAY_MS),
            endedAt: new Date(),
            endedBy: userId,
          },
        });
      } else if (input.source === 'INHERIT') {
        throw agentConflict(
          'COMMISSION_ALREADY_INHERITED',
          'الصنف يتبع اتفاقية الوكيل بالفعل',
          'This item already inherits the agent agreement rate.',
        );
      }
      if (input.source === 'OVERRIDE') {
        await tx.agentProductCommissionOverride.create({
          data: {
            productId,
            agentId: product.ownerAgentId,
            ratePercent: Number(input.ratePercent),
            effectiveFrom: from,
            reason: input.reason?.trim() || null,
            createdBy: userId,
          },
        });
      }
    });
    return this.productSetting(productId);
  }

  // ── Agreement preview (A3) ───────────────────────────────────────────────

  /**
   * What an agreement would apply, shown before activation: each agent-owned
   * product's class, rate source and rate on the agreement start date, plus
   * the worked example with the given (or A1 default) sample amounts.
   */
  async agreementPreview(
    agentId: string,
    agreementId: string,
    sample: {
      productSales?: number;
      serviceSales?: number;
      customerShipping?: number;
    },
  ) {
    const agreement = await this.prisma.agentAgreement.findFirst({
      where: { id: agreementId, agentId },
      include: { currency: { select: { code: true, symbol: true } } },
    });
    if (!agreement) throw agentNotFoundError('Agreement', 'الاتفاقية');
    const products = await this.prisma.product.findMany({
      where: { ownerAgentId: agentId, deletedAt: null },
      select: {
        id: true,
        sku: true,
        name: true,
        isInventoryItem: true,
        itemType: true,
      },
      orderBy: { name: 'asc' },
    });
    const overrides = await this.overridesInForce(
      agentId,
      products.map((p) => p.id),
      agreement.effectiveFrom,
    );
    const items = products.map((product) => {
      try {
        const rate = resolveLineCommissionRate({
          productId: product.id,
          itemType: product.itemType,
          agreement: {
            productCommissionRatePercent: Number(
              agreement.productCommissionRatePercent,
            ),
            serviceCommissionRatePercent: Number(
              agreement.serviceCommissionRatePercent,
            ),
          },
          override: overrides.get(product.id) ?? null,
        });
        return { ...product, ...rate, missing: null };
      } catch (error) {
        if (
          !(error instanceof AgentCommissionRateMissingError) &&
          !(error instanceof AgentItemTypeMissingError)
        ) {
          throw error;
        }
        return {
          ...product,
          commissionClass: product.itemType,
          rateSource: null,
          ratePercent: null,
          overrideId: null,
          /** Why no rate: the item is unclassified or its class has no rate. */
          missing: error.code,
        };
      }
    });
    const customerShipping =
      sample.customerShipping ?? COMMISSION_EXAMPLE_DEFAULTS.customerShipping;
    return {
      agreementId: agreement.id,
      agreementNumber: agreement.agreementNumber,
      status: agreement.status,
      effectiveFrom: agreement.effectiveFrom,
      currency: agreement.currency,
      shippingPolicy: agreement.shippingPolicy,
      example: commissionExample({
        productSales:
          sample.productSales ?? COMMISSION_EXAMPLE_DEFAULTS.productSales,
        serviceSales:
          sample.serviceSales ?? COMMISSION_EXAMPLE_DEFAULTS.serviceSales,
        productRatePercent: Number(agreement.productCommissionRatePercent),
        serviceRatePercent: Number(agreement.serviceCommissionRatePercent),
        // Customer shipping belongs to the company whatever the policy; under
        // PREDETERMINED_CHARGE it settles the equal agent shipping charge.
        customerShipping,
        predeterminedShippingCharge:
          agreement.shippingPolicy === 'PREDETERMINED_CHARGE'
            ? customerShipping
            : 0,
      }),
      items,
    };
  }
}
