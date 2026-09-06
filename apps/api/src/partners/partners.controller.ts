import {
  Body,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { PartnerRoleType, PartnerStatus } from '@prisma/client';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { PermissionsGuard } from '../auth/guards/permissions.guard';
import { PermissionModule } from '../auth/decorators/permission-module.decorator';
import {
  PermissionAction,
  SkipPermissionCheck,
} from '../auth/decorators/permission-action.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { JwtPayload } from '../auth/guards/jwt-auth.guard';
import { PartnersService } from './partners.service';
import { CreatePartnerDto } from './dto/create-partner.dto';
import { UpdatePartnerDto } from './dto/update-partner.dto';
import { FindOrCreatePartnerDto } from './dto/find-or-create-partner.dto';
import { FindPartnersQueryDto } from './dto/find-partners-query.dto';
import { AssignRoleDto } from './dto/assign-role.dto';
import { BulkIdsDto } from '../master-data/dto/bulk-ids.dto';
import { PermissionsResolverService } from '../permissions/permissions-resolver.service';

/**
 * Anyone who legitimately builds a document that references a Customer or
 * Supplier (Lead conversion, Store/Sales Order, Purchase Order, Journal
 * Entry) can browse the ACTIVE partner picker even without `partners.view` —
 * that permission stays reserved for full Partner/Supplier directory
 * management. Without this, a Sales Agent granted `partners.create` (to
 * quick-create a customer on an Order) had no way to pick an EXISTING
 * customer, and granting `partners.view` instead leaked the whole
 * "Purchasing" sidebar section into view (Suppliers lives there and shares
 * this same permission — see ProductsController.catalog() for the identical
 * pattern already established for Products).
 */
const CATALOG_READ_PERMISSIONS = [
  'partners.view',
  'crm.leads.convert',
  'store-orders.create',
  'store-orders.edit',
  'sales.quotations.create',
  'sales.orders.create',
  'sales.invoices.create',
  'sales.returns.create',
  'purchasing.quotations.create',
  'purchasing.orders.create',
  'purchasing.invoices.create',
  'purchasing.returns.create',
  'accounting.journal-entries.create',
];

/** Business operations: Create, Update, Archive, Restore, Search, Find-or-Create, Assign/Remove Role. Customers/Suppliers pages are role-filtered views over this same registry (spec sections 9/10/12). */
@Controller('partners')
@UseGuards(JwtAuthGuard, PermissionsGuard)
@PermissionModule('partners')
export class PartnersController {
  constructor(
    private readonly partnersService: PartnersService,
    private readonly permissions: PermissionsResolverService,
  ) {}

  @Post()
  create(@Body() dto: CreatePartnerDto, @CurrentUser() user: JwtPayload) {
    return this.partnersService.create(dto, user.sub);
  }

  @Post('find-or-create')
  findOrCreate(
    @Body() dto: FindOrCreatePartnerDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.partnersService.findOrCreateWithRole(dto, user.sub);
  }

  /** Read-only "does this phone number already belong to a Partner?" check — used before creating a Lead/Order/Partner. Never writes. */
  @Get('lookup')
  lookupByPhone(@Query('phone') phone: string) {
    return this.partnersService.lookupByPhone(phone);
  }

  /** "Select all matching filters" — bare IDs only, same filter/search as `findAll`. */
  @Get('ids')
  findAllIds(@Query() query: FindPartnersQueryDto) {
    return this.partnersService.findAllIds(query);
  }

  /** Static route — must precede `:id`. */
  @Get('catalog')
  @SkipPermissionCheck()
  async catalog(
    @Query() query: FindPartnersQueryDto,
    @CurrentUser() user: JwtPayload,
  ) {
    const isSuperAdmin = await this.permissions.isSuperAdmin(user.sub);
    if (!isSuperAdmin) {
      const grants = await Promise.all(
        CATALOG_READ_PERMISSIONS.map((name) =>
          this.permissions.hasPermission(user.sub, name),
        ),
      );
      if (!grants.some(Boolean)) {
        throw new ForbiddenException(
          'You need a document-creation permission to browse the partner picker.',
        );
      }
    }
    return this.partnersService.findAll({
      ...query,
      status: [PartnerStatus.ACTIVE],
    });
  }

  @Get()
  findAll(@Query() query: FindPartnersQueryDto) {
    return this.partnersService.findAll(query);
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.partnersService.findOne(id);
  }

  @Get(':id/activity')
  activity(@Param('id') id: string) {
    return this.partnersService.activityFor(id);
  }

  @Patch(':id')
  update(
    @Param('id') id: string,
    @Body() dto: UpdatePartnerDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.partnersService.update(id, dto, user.sub);
  }

  @Post(':id/roles')
  @PermissionAction('edit')
  assignRole(
    @Param('id') id: string,
    @Body() dto: AssignRoleDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.partnersService.assignRole(id, dto.role, user.sub);
  }

  @Delete(':id/roles/:role')
  @PermissionAction('edit')
  removeRole(
    @Param('id') id: string,
    @Param('role') role: PartnerRoleType,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.partnersService.removeRole(id, role, user.sub);
  }

  @Post(':id/archive')
  @PermissionAction('delete')
  archive(@Param('id') id: string, @CurrentUser() user: JwtPayload) {
    return this.partnersService.archive(id, user.sub);
  }

  @Post('bulk-archive')
  @PermissionAction('delete')
  bulkArchive(@Body() dto: BulkIdsDto, @CurrentUser() user: JwtPayload) {
    return this.partnersService.archiveMany(dto.ids, user.sub);
  }

  @Post(':id/restore')
  @SkipPermissionCheck()
  restore(@Param('id') id: string, @CurrentUser() user: JwtPayload) {
    return this.partnersService.restore(id, user.sub);
  }
}
