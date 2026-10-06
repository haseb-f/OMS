import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { PermissionsGuard } from '../../auth/guards/permissions.guard';
import { PermissionModule } from '../../auth/decorators/permission-module.decorator';
import { PermissionAction } from '../../auth/decorators/permission-action.decorator';
import { CurrentUser } from '../../auth/decorators/current-user.decorator';
import type { JwtPayload } from '../../auth/guards/jwt-auth.guard';
import {
  CurrentCompanyContext,
  type CompanyContext,
} from '../../common/decorators/current-company-context.decorator';
import { SalesInvoicesService } from './sales-invoices.service';
import { CreateSalesInvoiceDto } from './dto/create-sales-invoice.dto';
import { UpdateSalesInvoiceDto } from './dto/update-sales-invoice.dto';
import { FindSalesInvoicesQueryDto } from './dto/find-sales-invoices-query.dto';
import { PermissionsResolverService } from '../../permissions/permissions-resolver.service';
import { canViewInventoryCost } from '../../inventory/inventory-cost-access';
import { redactDocumentLinesCost } from '../../inventory/inventory-cost-visibility';

/** Business operations only: Create, Update, Submit, Approve, Confirm (Reduce Inventory), Cancel, Archive, Search, Details. */
@Controller('sales/invoices')
@UseGuards(JwtAuthGuard, PermissionsGuard)
@PermissionModule('sales-invoices')
export class SalesInvoicesController {
  constructor(
    private readonly invoicesService: SalesInvoicesService,
    private readonly permissions: PermissionsResolverService,
  ) {}

  /**
   * Line cost (COGS `unitCost`, kit component snapshot costs, the product's
   * moving average) is inventory valuation: only for callers with cost
   * visibility — the same rule as stock cards (`canViewInventoryCost`).
   */
  private async withCostRule<T extends { items?: unknown }>(
    userId: string,
    invoice: Promise<T>,
  ): Promise<T> {
    const [result, showCost] = await Promise.all([
      invoice,
      canViewInventoryCost(this.permissions, userId),
    ]);
    return showCost ? result : redactDocumentLinesCost(result);
  }

  @Post()
  create(
    @Body() dto: CreateSalesInvoiceDto,
    @CurrentCompanyContext() context: CompanyContext,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.withCostRule(
      user.sub,
      this.invoicesService.create(dto, context),
    );
  }

  @Get()
  async findAll(
    @Query() query: FindSalesInvoicesQueryDto,
    @CurrentUser() user: JwtPayload,
  ) {
    const [page, showCost] = await Promise.all([
      this.invoicesService.findAll(query),
      canViewInventoryCost(this.permissions, user.sub),
    ]);
    return showCost
      ? page
      : { ...page, items: page.items.map(redactDocumentLinesCost) };
  }

  @Get(':id')
  findOne(@Param('id') id: string, @CurrentUser() user: JwtPayload) {
    return this.withCostRule(user.sub, this.invoicesService.findOne(id));
  }

  @Get(':id/posting-preview')
  buildPostingPreview(@Param('id') id: string) {
    return this.invoicesService.buildPostingPreview(id);
  }

  @Patch(':id')
  update(
    @Param('id') id: string,
    @Body() dto: UpdateSalesInvoiceDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.withCostRule(user.sub, this.invoicesService.update(id, dto));
  }

  /** Draft → Submitted is the editor's own transition — the same `edit` authority the editor shell gates on (SEC-03 H2 audit). */
  @Post(':id/submit')
  @HttpCode(200)
  @PermissionAction('edit')
  submit(@Param('id') id: string, @CurrentUser() user: JwtPayload) {
    return this.withCostRule(user.sub, this.invoicesService.submit(id));
  }

  @Post(':id/approve')
  @HttpCode(200)
  @PermissionAction('approve')
  approve(@Param('id') id: string, @CurrentUser() user: JwtPayload) {
    return this.withCostRule(user.sub, this.invoicesService.approve(id));
  }

  @Post(':id/confirm')
  @HttpCode(200)
  @PermissionAction('confirm')
  confirm(@Param('id') id: string, @CurrentUser() user: JwtPayload) {
    return this.withCostRule(
      user.sub,
      this.invoicesService.confirm(id, user.sub),
    );
  }

  @Post(':id/cancel')
  @HttpCode(200)
  @PermissionAction('cancel')
  cancel(@Param('id') id: string, @CurrentUser() user: JwtPayload) {
    return this.withCostRule(
      user.sub,
      this.invoicesService.cancel(id, user.sub),
    );
  }

  @Post(':id/archive')
  @HttpCode(200)
  @PermissionAction('delete')
  archive(@Param('id') id: string, @CurrentUser() user: JwtPayload) {
    return this.withCostRule(
      user.sub,
      this.invoicesService.archive(id, user.sub),
    );
  }

  /** New Draft copy — business fields only (never postings/payments/approvals). */
  @Post(':id/duplicate')
  @HttpCode(200)
  @PermissionAction('create')
  duplicate(@Param('id') id: string, @CurrentUser() user: JwtPayload) {
    return this.withCostRule(
      user.sub,
      this.invoicesService.duplicate(id, user.sub),
    );
  }

  @Post(':id/return-to-draft')
  @HttpCode(200)
  @PermissionAction('edit')
  returnToDraft(@Param('id') id: string, @CurrentUser() user: JwtPayload) {
    return this.withCostRule(
      user.sub,
      this.invoicesService.returnToDraft(id, user.sub),
    );
  }
}
