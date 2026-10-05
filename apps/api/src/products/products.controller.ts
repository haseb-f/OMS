import {
  Body,
  Controller,
  ForbiddenException,
  Get,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ProductsService } from './products.service';
import { CreateProductDto } from './dto/create-product.dto';
import { UpdateProductDto } from './dto/update-product.dto';
import { FindProductsQueryDto } from './dto/find-products-query.dto';
import { CreateProductAttachmentDto } from './dto/create-product-attachment.dto';
import { SimilarProductNamesQueryDto } from './dto/similar-product-names-query.dto';
import {
  ProductInsightsService,
  type ProductInsightAccess,
} from './product-insights.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { PermissionsGuard } from '../auth/guards/permissions.guard';
import { PermissionModule } from '../auth/decorators/permission-module.decorator';
import {
  PermissionAction,
  SkipPermissionCheck,
} from '../auth/decorators/permission-action.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { JwtPayload } from '../auth/guards/jwt-auth.guard';
import { PermissionsResolverService } from '../permissions/permissions-resolver.service';

/**
 * Anyone who legitimately builds a document that lines a Product on it
 * (Lead conversion, Store Order, Purchase Order, Inventory movement) can
 * browse the ACTIVE sellable catalog even without `products.view` — that
 * permission stays reserved for Product management (full record, cost/
 * purchase data). See `ProductsService.findSellableCatalog()`.
 */
export const PRODUCT_CATALOG_READ_PERMISSIONS: readonly string[] = [
  'products.view',
  'crm.leads.convert',
  'store-orders.create',
  'store-orders.edit',
  'purchasing.orders.create',
  'purchasing.orders.edit',
  // Every commercial document editor lines products (quotations, orders,
  // invoices, returns) — the same set PartnersController grants lookup to.
  'sales.quotations.create',
  'sales.orders.create',
  'sales.invoices.create',
  'sales.returns.create',
  'purchasing.quotations.create',
  'purchasing.invoices.create',
  'purchasing.returns.create',
  'inventory.movements.create',
  // Investor Engine Milestone 4, Part 11 — root cause of "the Investment
  // Opportunity Product dropdown shows nothing": an Investor-module user
  // holding only investment-opportunities.* permissions (no products.view,
  // no order-creation permission) was silently 403'd out of this whitelist,
  // and the frontend combobox renders that as an empty list rather than an
  // error. Anyone who can create/edit an Opportunity must be able to browse
  // the catalog to fund it.
  'investment-opportunities.create',
  'investment-opportunities.edit',
  // Lead create/edit form's "Product" field (MasterDataForm type:"product").
  'crm.leads.create',
  'crm.leads.edit',
  // Cost screens that pick a product to inspect: Product Cost history
  // (/expenses/product-cost, gated on expenses.view) and Cost Explorer's
  // product panel (/expenses/cost-explorer, gated on cost-explorer.view).
  'expenses.view',
  'cost-explorer.view',
];

/** Inherited GL accounts are finance data: any of these (or Super Admin) unlocks them on `effective-defaults`. */
export const PRODUCT_ACCOUNT_VIEW_PERMISSIONS: readonly string[] = [
  'finance.view',
  'accounting.chart-of-accounts.view',
  'accounting.journal-entries.view',
];

@Controller('products')
@UseGuards(JwtAuthGuard, PermissionsGuard)
@PermissionModule('products')
export class ProductsController {
  constructor(
    private readonly productsService: ProductsService,
    private readonly insights: ProductInsightsService,
    private readonly permissions: PermissionsResolverService,
  ) {}

  @Post()
  create(@Body() dto: CreateProductDto, @CurrentUser() user: JwtPayload) {
    return this.productsService.create(dto, user.sub);
  }

  /** What this caller may see of the inherited / linked sections beyond `products.view`. */
  private async insightAccess(user: JwtPayload): Promise<ProductInsightAccess> {
    const holdsAny = async (names: readonly string[]) => {
      for (const name of names) {
        if (await this.permissions.hasPermission(user.sub, name)) return true;
      }
      return false;
    };
    return {
      accounts: await holdsAny(PRODUCT_ACCOUNT_VIEW_PERMISSIONS),
      commission: await holdsAny(['agents.view']),
      opportunities: await holdsAny(['investment-opportunities.view']),
    };
  }

  @Get()
  findAll(@Query() query: FindProductsQueryDto) {
    return this.productsService.findAll(query);
  }

  /** Static route — must precede `:id`. */
  @Get('catalog')
  @SkipPermissionCheck()
  async catalog(
    @Query() query: FindProductsQueryDto,
    @CurrentUser() user: JwtPayload,
  ) {
    const isSuperAdmin = await this.permissions.isSuperAdmin(user.sub);
    if (!isSuperAdmin) {
      const grants = await Promise.all(
        PRODUCT_CATALOG_READ_PERMISSIONS.map((name) =>
          this.permissions.hasPermission(user.sub, name),
        ),
      );
      if (!grants.some(Boolean)) {
        throw new ForbiddenException(
          'You need an order- or movement-creation permission to browse the product catalog.',
        );
      }
      // Agents milestone — an agent's products are listed only for internal
      // staff who may see agents (company flows never see agent goods).
      if (
        query.agentId &&
        !(await this.permissions.hasPermission(user.sub, 'agents.view'))
      ) {
        throw new ForbiddenException({
          code: 'AGENT_PERMISSION_REQUIRED',
          message:
            'عرض منتجات الوكلاء يتطلب صلاحية عرض الوكلاء — Listing an agent’s products requires the agents.view permission.',
        });
      }
    }
    return this.productsService.findSellableCatalog(query);
  }

  /** Static route — must precede `:id`. Advisory only: a match never blocks saving. */
  @Get('similar-names')
  similarNames(@Query() query: SimilarProductNamesQueryDto) {
    return this.insights.findSimilarNames({
      name: query.name ?? '',
      excludeId: query.excludeId,
      categoryId: query.categoryId,
    });
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.productsService.findOne(id);
  }

  /** Read-only inheritance (unit, tax, accounts, commission); sections the caller may not see are omitted. */
  @Get(':id/effective-defaults')
  async effectiveDefaults(
    @Param('id') id: string,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.insights.effectiveDefaults(id, await this.insightAccess(user));
  }

  /** Investor eligibility; linked opportunities only for holders of `investment-opportunities.view`. */
  @Get(':id/investment-links')
  async investmentLinks(
    @Param('id') id: string,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.insights.investmentLinks(id, await this.insightAccess(user));
  }

  @Patch(':id')
  update(
    @Param('id') id: string,
    @Body() dto: UpdateProductDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.productsService.update(id, dto, user.sub);
  }

  /** Product Creation Wizard — the "تفعيل المنتج" action. Reuses the `edit` permission, same as `PATCH` (POST defaults to `create`, which activation is not). */
  @Post(':id/activate')
  @PermissionAction('edit')
  activate(@Param('id') id: string, @CurrentUser() user: JwtPayload) {
    return this.productsService.activate(id, user.sub);
  }

  @Post(':id/archive')
  @PermissionAction('delete')
  archive(@Param('id') id: string, @CurrentUser() user: JwtPayload) {
    return this.productsService.archive(id, user.sub);
  }

  /** Same authority as Archive (SEC-03 H2) — un-archiving is the other half of the soft-delete. */
  @Post(':id/restore')
  @PermissionAction('delete')
  restore(@Param('id') id: string, @CurrentUser() user: JwtPayload) {
    return this.productsService.restore(id, user.sub);
  }

  /** Adding an attachment modifies the Product — `edit`, same as PATCH (SEC-03 H2 audit). */
  @Post(':id/attachments')
  @PermissionAction('edit')
  attach(
    @Param('id') id: string,
    @Body() dto: CreateProductAttachmentDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.productsService.attach(id, dto, user.sub);
  }
}
