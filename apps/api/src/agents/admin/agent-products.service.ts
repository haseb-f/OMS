import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { ProductsService } from '../../products/products.service';
import { PermissionsResolverService } from '../../permissions/permissions-resolver.service';
import {
  agentConflict,
  agentForbidden,
  agentNotFoundError,
} from '../common/agent-errors';
import { AgentCommissionRatesService } from '../commission/agent-commission-rates.service';
import {
  AgentCommissionRateMissingError,
  AgentItemTypeMissingError,
  resolveLineCommissionRate,
} from '../commission/agent-commission';
import { resolveActiveAgreement } from './agent-agreements.service';

const PRODUCT_SELECT = {
  id: true,
  sku: true,
  name: true,
  nameEn: true,
  displayName: true,
  itemType: true,
  status: true,
  isSellable: true,
  isInventoryItem: true,
} as const;

/**
 * Agent page → Products tab (spec-2-agent-pricing.md 2A). Linking and
 * unlinking go through `ProductsService.update` — the one product update
 * path, with its owner validation (active agent) and ownership lock
 * (PRODUCT_OWNER_LOCKED once the product is referenced).
 */
@Injectable()
export class AgentProductsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly products: ProductsService,
    private readonly commissionRates: AgentCommissionRatesService,
    private readonly resolver: PermissionsResolverService,
  ) {}

  /** The agent's products with the commission in force today (override / agreement). */
  async list(agentId: string) {
    await this.requireAgent(agentId);
    const today = new Date();
    const [items, agreement] = await Promise.all([
      this.prisma.product.findMany({
        where: { ownerAgentId: agentId, deletedAt: null },
        select: PRODUCT_SELECT,
        orderBy: [{ displayName: 'asc' }, { sku: 'asc' }],
      }),
      resolveActiveAgreement(agentId, today, this.prisma),
    ]);
    const overrides = await this.commissionRates.overridesInForce(
      agentId,
      items.map((p) => p.id),
      today,
    );
    return {
      agreement: agreement
        ? { id: agreement.id, agreementNumber: agreement.agreementNumber }
        : null,
      items: items.map((product) => {
        const override = overrides.get(product.id) ?? null;
        let commission: {
          source: 'OVERRIDE' | 'AGREEMENT' | null;
          ratePercent: number | null;
          missing: string | null;
        };
        if (override) {
          commission = {
            source: 'OVERRIDE',
            ratePercent: override.ratePercent,
            missing: null,
          };
        } else if (!agreement) {
          commission = {
            source: null,
            ratePercent: null,
            missing: 'NO_ACTIVE_AGREEMENT',
          };
        } else {
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
              override: null,
            });
            commission = {
              source: 'AGREEMENT',
              ratePercent: rate.ratePercent,
              missing: null,
            };
          } catch (error) {
            if (
              !(error instanceof AgentItemTypeMissingError) &&
              !(error instanceof AgentCommissionRateMissingError)
            ) {
              throw error;
            }
            commission = {
              source: null,
              ratePercent: null,
              missing: error.code,
            };
          }
        }
        return { ...product, commission };
      }),
    };
  }

  /** Company-owned products an agent manager may link (searchable, narrow select). */
  async linkable(agentId: string, search?: string) {
    await this.requireAgent(agentId);
    const term = search?.trim();
    return this.prisma.product.findMany({
      where: {
        ownerAgentId: null,
        deletedAt: null,
        ...(term
          ? {
              OR: [
                { sku: { contains: term, mode: 'insensitive' } },
                { name: { contains: term, mode: 'insensitive' } },
                { nameEn: { contains: term, mode: 'insensitive' } },
                { displayName: { contains: term, mode: 'insensitive' } },
              ],
            }
          : {}),
      },
      select: PRODUCT_SELECT,
      orderBy: [{ displayName: 'asc' }, { sku: 'asc' }],
      take: 20,
    });
  }

  /** Company-owned product → this agent (same validation and lock as the product editor). */
  async link(agentId: string, productId: string, userId: string) {
    await this.assertCanEditProducts(userId);
    await this.requireAgent(agentId);
    const product = await this.requireProduct(productId);
    if (product.ownerAgentId === agentId)
      return this.products.findOne(productId);
    if (product.ownerAgentId) {
      throw agentConflict(
        'PRODUCT_OWNED_BY_ANOTHER_AGENT',
        'المنتج مملوك لوكيل آخر — افصله عنه أولًا',
        'The product belongs to another agent — unlink it there first.',
      );
    }
    // Atomic: refused if another link won meanwhile (PRODUCT_OWNER_CHANGED).
    return this.products.changeOwner(productId, null, agentId, userId);
  }

  /** This agent's product → company (refused with PRODUCT_OWNER_LOCKED once referenced). */
  async unlink(agentId: string, productId: string, userId: string) {
    await this.assertCanEditProducts(userId);
    await this.requireAgent(agentId);
    const product = await this.requireProduct(productId);
    if (product.ownerAgentId !== agentId) {
      throw agentNotFoundError('Product', 'المنتج');
    }
    return this.products.changeOwner(productId, agentId, null, userId);
  }

  /** Ownership is a product change too: `products.edit` besides `agents.edit`. */
  private async assertCanEditProducts(userId: string) {
    if (!(await this.resolver.hasPermission(userId, 'products.edit'))) {
      throw agentForbidden(
        'PERMISSION_REQUIRED',
        'ربط المنتجات بالوكيل يتطلب صلاحية تعديل المنتجات',
        'Linking products to an agent requires the products.edit permission.',
      );
    }
  }

  private async requireAgent(agentId: string) {
    const agent = await this.prisma.agent.findFirst({
      where: { id: agentId, deletedAt: null },
      select: { id: true },
    });
    if (!agent) throw agentNotFoundError('Agent', 'الوكيل');
  }

  private async requireProduct(productId: string) {
    const product = await this.prisma.product.findFirst({
      where: { id: productId, deletedAt: null },
      select: { id: true, ownerAgentId: true },
    });
    if (!product) throw agentNotFoundError('Product', 'المنتج');
    return product;
  }
}
