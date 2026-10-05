import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AccountMappingService } from '../accounting/account-mapping/account-mapping.service';
import { AgentCommissionRatesService } from '../agents/commission/agent-commission-rates.service';
import {
  AgentCommissionRateMissingError,
  AgentItemTypeMissingError,
} from '../agents/commission/agent-commission';
import { resolveActiveAgreement } from '../agents/admin/agent-agreements.service';
import { investmentBlockedReason } from '../investment-opportunities/shared/investment-eligibility.util';
import {
  escapeLikePattern,
  normalizedArabicColumnSql,
} from '../common/text/arabic-search';
import {
  SIMILAR_NAME_MIN_TOKEN_LENGTH,
  bestNameMatch,
  compareNameMatches,
  normalizeProductName,
  productNameTokens,
} from './product-name-similarity';

/** Most rows the similar-name look-up returns — a hint, never a list. */
export const SIMILAR_NAMES_LIMIT = 5;
/** Candidate rows pulled by the cheap SQL prefilter before the in-memory classification. */
const SIMILAR_NAMES_CANDIDATE_CAP = 300;
const SIMILAR_NAMES_MAX_TOKENS = 6;

/** The four account kinds the product form shows as inherited (never entered per product). */
export type ProductAccountKind = 'inventory' | 'cogs' | 'revenue' | 'purchase';

/** What the caller may see — resolved by the controller from the permission set. */
export interface ProductInsightAccess {
  accounts: boolean;
  commission: boolean;
  opportunities: boolean;
}

/** Account columns of a category that make an account "from the category" instead of Posting Settings. */
const CATEGORY_ACCOUNT_COLUMN = {
  inventory: 'inventoryAccountId',
  cogs: 'cogsAccountId',
  revenue: 'revenueAccountId',
  purchase: 'purchaseAccountId',
} as const;

/**
 * Read-only "what does this product inherit / where is it used" views for the
 * product form (R13): name look-alikes, effective defaults (unit, tax,
 * accounts, commission) and investment links. Accounts are never resolved
 * here — `AccountMappingService` stays the single resolver; this only labels
 * where its answer came from.
 */
@Injectable()
export class ProductInsightsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly accountMapping: AccountMappingService,
    private readonly commissionRates: AgentCommissionRatesService,
  ) {}

  /**
   * Non-blocking duplicate-name hint: EXACT / CONTAINS (from 4 characters) /
   * SIMILAR among non-archived products, Arabic-normalized, at most 5.
   */
  async findSimilarNames(query: {
    name: string;
    excludeId?: string;
    categoryId?: string;
  }) {
    const needle = normalizeProductName(query.name ?? '');
    if (!needle) return { items: [] };

    const tokens = productNameTokens(needle)
      .filter((token) => token.length >= SIMILAR_NAME_MIN_TOKEN_LENGTH)
      .slice(0, SIMILAR_NAMES_MAX_TOKENS);
    // A name made only of short tokens is looked up whole.
    const prefixes = (tokens.length ? tokens : [needle]).map((token) =>
      token.slice(0, SIMILAR_NAME_MIN_TOKEN_LENGTH),
    );
    const columns = [
      '"name"',
      '"display_name"',
      '"internal_name"',
      '"name_en"',
    ];
    const conditions = columns.flatMap((column) =>
      prefixes.map(
        (prefix) =>
          Prisma.sql`${normalizedArabicColumnSql(column)} LIKE ${`%${escapeLikePattern(prefix)}%`}`,
      ),
    );
    const candidateIds = await this.prisma.$queryRaw<{ id: string }[]>(
      Prisma.sql`SELECT id::text AS id FROM "products"
        WHERE "deleted_at" IS NULL
        ${query.excludeId ? Prisma.sql`AND "id" <> ${query.excludeId}::uuid` : Prisma.empty}
        AND (${Prisma.join(conditions, ' OR ')})
        LIMIT ${SIMILAR_NAMES_CANDIDATE_CAP}`,
    );
    if (candidateIds.length === 0) return { items: [] };

    const rows = await this.prisma.product.findMany({
      where: { id: { in: candidateIds.map((row) => row.id) } },
      select: {
        id: true,
        sku: true,
        name: true,
        nameEn: true,
        displayName: true,
        internalName: true,
        status: true,
        categoryId: true,
        category: { select: { name: true } },
      },
    });

    const items = rows
      .flatMap((row) => {
        const match = bestNameMatch(needle, [
          row.name,
          row.displayName,
          row.internalName,
          row.nameEn,
        ]);
        return match
          ? [
              {
                id: row.id,
                sku: row.sku,
                name: row.name,
                displayName: row.displayName,
                categoryName: row.category.name,
                status: row.status,
                match,
                sameCategory: row.categoryId === query.categoryId,
              },
            ]
          : [];
      })
      .sort(
        (a, b) =>
          compareNameMatches(a, b) || a.name.localeCompare(b.name, 'ar'),
      )
      .slice(0, SIMILAR_NAMES_LIMIT);
    return {
      items: items.map((item) => ({
        id: item.id,
        sku: item.sku,
        name: item.name,
        displayName: item.displayName,
        categoryName: item.categoryName,
        status: item.status,
        match: item.match,
      })),
    };
  }

  /**
   * Inheritance on the product page — read-only. `source` says whether a value
   * is the product's own or matches the category default; accounts and
   * commission sections are omitted when the caller may not see them.
   */
  async effectiveDefaults(productId: string, access: ProductInsightAccess) {
    const product = await this.prisma.product.findFirst({
      where: { id: productId, deletedAt: null },
      select: {
        id: true,
        itemType: true,
        categoryId: true,
        unitId: true,
        taxId: true,
        ownerAgentId: true,
        unit: { select: { id: true, name: true } },
        tax: { select: { id: true, name: true } },
        category: {
          select: {
            defaultUnitId: true,
            defaultTaxId: true,
            inventoryAccountId: true,
            cogsAccountId: true,
            revenueAccountId: true,
            purchaseAccountId: true,
          },
        },
      },
    });
    if (!product) throw notFound(productId);

    const result: {
      unit: { id: string; name: string; source: 'PRODUCT' | 'CATEGORY' };
      tax: {
        id: string;
        name: string;
        source: 'PRODUCT' | 'CATEGORY';
      } | null;
      accounts?: Record<
        ProductAccountKind,
        {
          id: string;
          code: string;
          name: string;
          source: 'CATEGORY' | 'SETTINGS';
        } | null
      >;
      commission?: Awaited<ReturnType<typeof this.commissionFor>>;
    } = {
      unit: {
        ...product.unit,
        source:
          product.unitId === product.category.defaultUnitId
            ? 'CATEGORY'
            : 'PRODUCT',
      },
      // Documents default a line's tax from the product alone — an empty tax
      // stays "no VAT"; it is never silently taken from the category later.
      tax: product.tax
        ? {
            ...product.tax,
            source:
              product.taxId === product.category.defaultTaxId
                ? 'CATEGORY'
                : 'PRODUCT',
          }
        : null,
    };
    if (access.accounts) {
      result.accounts = await this.accountsFor(
        product.categoryId,
        product.category,
      );
    }
    if (access.commission) {
      result.commission = await this.commissionFor(product);
    }
    return result;
  }

  private async accountsFor(
    categoryId: string,
    category: Record<
      (typeof CATEGORY_ACCOUNT_COLUMN)[ProductAccountKind],
      string | null
    >,
  ) {
    // No supplier / customer group at product level: those overrides apply to
    // the individual document, not to the product's own default.
    const NO_PARTNER = '00000000-0000-0000-0000-000000000000';
    const resolvers: Record<ProductAccountKind, () => Promise<string>> = {
      inventory: () => this.accountMapping.resolveInventoryAccount(categoryId),
      cogs: () => this.accountMapping.resolveCogsAccount(categoryId),
      revenue: () =>
        this.accountMapping.resolveSalesRevenueAccount(categoryId, null),
      purchase: () =>
        this.accountMapping.resolvePurchaseAccount(NO_PARTNER, categoryId),
    };
    const kinds = Object.keys(resolvers) as ProductAccountKind[];
    const accountIds = await Promise.all(
      kinds.map(async (kind) => {
        try {
          return await resolvers[kind]();
        } catch (error) {
          // "Nothing configured" is a valid answer here, not an error.
          if (error instanceof BadRequestException) return null;
          throw error;
        }
      }),
    );
    const accounts = await this.prisma.chartOfAccount.findMany({
      where: { id: { in: accountIds.filter((id): id is string => !!id) } },
      select: { id: true, code: true, name: true },
    });
    const byId = new Map(accounts.map((account) => [account.id, account]));
    return Object.fromEntries(
      kinds.map((kind, index) => {
        const account = accountIds[index] ? byId.get(accountIds[index]) : null;
        return [
          kind,
          account
            ? {
                ...account,
                source:
                  category[CATEGORY_ACCOUNT_COLUMN[kind]] === account.id
                    ? 'CATEGORY'
                    : 'SETTINGS',
              }
            : null,
        ];
      }),
    ) as Record<
      ProductAccountKind,
      {
        id: string;
        code: string;
        name: string;
        source: 'CATEGORY' | 'SETTINGS';
      } | null
    >;
  }

  /** Agent-owned products only: the rate the active agreement / item override would apply today. */
  private async commissionFor(product: {
    id: string;
    itemType: 'PRODUCT' | 'SERVICE' | null;
    ownerAgentId: string | null;
  }) {
    if (!product.ownerAgentId) return null;
    const today = new Date();
    const none = {
      itemType: product.itemType,
      rate: null,
      source: null,
    } as const;
    const agreement = await resolveActiveAgreement(
      product.ownerAgentId,
      today,
      this.prisma,
    );
    if (!agreement) return none;
    try {
      const [line] = await this.commissionRates.resolveLineRates(
        agreement,
        [{ productId: product.id, itemType: product.itemType }],
        today,
      );
      return {
        itemType: product.itemType,
        rate: line.ratePercent,
        source:
          line.rateSource === 'ITEM_OVERRIDE'
            ? ('ITEM_OVERRIDE' as const)
            : ('AGREEMENT' as const),
      };
    } catch (error) {
      if (
        error instanceof AgentCommissionRateMissingError ||
        error instanceof AgentItemTypeMissingError
      ) {
        return none;
      }
      throw error;
    }
  }

  /**
   * Eligibility for investment opportunities and (for callers who may see
   * opportunities) the opportunities that already carry the product.
   */
  async investmentLinks(productId: string, access: ProductInsightAccess) {
    const product = await this.prisma.product.findFirst({
      where: { id: productId, deletedAt: null },
      select: {
        status: true,
        deletedAt: true,
        ownerAgentId: true,
        itemType: true,
        type: true,
        isSellable: true,
        availableForInvestmentOpportunities: true,
      },
    });
    if (!product) throw notFound(productId);

    const blockedReason = investmentBlockedReason(product);
    let opportunities: Array<{
      id: string;
      code: string;
      nameAr: string;
      nameEn: string | null;
      status: string;
      fundedUnits: number;
      fundedUnitCost: string;
    }> | null = null;
    if (access.opportunities) {
      const links = await this.prisma.opportunityProduct.findMany({
        where: {
          productId,
          deletedAt: null,
          opportunity: { deletedAt: null },
        },
        select: {
          fundedUnits: true,
          fundedUnitCost: true,
          opportunity: {
            select: {
              id: true,
              code: true,
              nameAr: true,
              nameEn: true,
              status: true,
            },
          },
        },
        orderBy: { createdAt: 'desc' },
      });
      opportunities = links.map((link) => ({
        ...link.opportunity,
        fundedUnits: link.fundedUnits,
        fundedUnitCost: link.fundedUnitCost.toFixed(2),
      }));
    }
    return {
      eligible:
        blockedReason === null && product.availableForInvestmentOpportunities,
      blockedReason,
      opportunities,
    };
  }
}

function notFound(productId: string) {
  return new NotFoundException(`Product ${productId} not found`);
}
