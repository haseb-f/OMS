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
import {
  CATALOG_SORTABLE_FIELDS,
  canSearchContacts,
  effectiveCatalogRoleFilter,
  projectCatalogRow,
  resolvePartnerCatalogScope,
  type PartnerCatalogScope,
} from './partner-catalog-scope';

/**
 * Anyone who legitimately builds a document that references a Customer or
 * Supplier can browse the ACTIVE partner picker even without `partners.view`
 * (see ProductsController.catalog() for the same pattern) — but only for the
 * roles that screen picks and, unless the screen reads them, without
 * contact/profile/balance fields. The per-permission scope lives in
 * `partner-catalog-scope.ts` (SEC-01).
 */
export { PARTNER_CATALOG_READ_PERMISSIONS } from './partner-catalog-scope';

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

  /**
   * Quick Create (spec section 39). Gated by `partners.create` only, and it
   * matches on phone/email/tax number/CR — so without `partners.view` the
   * reused/created Partner comes back through the same projection the
   * caller's picker catalog would give (picker fields, or the CUSTOMER
   * detail block a Store Order / Sales document creator already sees), with
   * `roles` narrowed to the requested role — never the full record (SEC-03
   * H3). Attaching a role to an existing EMPLOYEE/INVESTOR identity needs
   * `partners.edit` (enforced in the service).
   */
  @Post('find-or-create')
  async findOrCreate(
    @Body() dto: FindOrCreatePartnerDto,
    @CurrentUser() user: JwtPayload,
  ) {
    const [isSuperAdmin, grants] = await Promise.all([
      this.permissions.isSuperAdmin(user.sub),
      this.permissions.getPermissions(user.sub),
    ]);
    const holds = (name: string) => isSuperAdmin || grants.has(name);
    const result = await this.partnersService.findOrCreateWithRole(
      dto,
      user.sub,
      { mayExtendSensitiveIdentity: holds('partners.edit') },
    );
    if (holds('partners.view')) return result;
    const catalogScope = resolvePartnerCatalogScope(false, grants);
    const requestedOnly: PartnerCatalogScope = {
      roles: new Set([dto.role]),
      detailRoles:
        catalogScope &&
        (catalogScope.detailRoles === 'ANY' ||
          catalogScope.detailRoles.has(dto.role))
          ? new Set([dto.role])
          : new Set(),
    };
    return {
      created: result.created,
      partner: projectCatalogRow(result.partner, requestedOnly),
    };
  }

  /** Read-only "does this phone number already belong to a Partner?" check — used before creating a Lead/Order/Partner. Never writes. */
  @Get('lookup')
  lookupByPhone(@Query('phone') phone: string) {
    return this.partnersService.lookupByPhone(phone);
  }

  /**
   * Exact-phone global lookup — gated by `customers.lookup_global`, NOT
   * `partners.view`. Lets a Sales Agent who cannot browse the Partner
   * directory still recognize a returning Customer and see a safe, limited
   * previous-orders summary (never profit/commission/finance/other-agent
   * identity). Static route — must precede `:id`.
   */
  @Get('global-lookup')
  @PermissionAction('lookup_global')
  globalLookupByPhone(
    @Query('phone') phone: string,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.partnersService.globalLookupByPhone(phone, user.sub);
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
    const [isSuperAdmin, grants] = await Promise.all([
      this.permissions.isSuperAdmin(user.sub),
      this.permissions.getPermissions(user.sub),
    ]);
    const scope = resolvePartnerCatalogScope(isSuperAdmin, grants);
    if (!scope) {
      throw new ForbiddenException(
        'You need a document-creation permission to browse the partner picker.',
      );
    }
    const role = effectiveCatalogRoleFilter(query.role, scope);
    // Only knobs that NARROW the picker are honoured (SEC-03 L1/L2): ACTIVE
    // and non-archived are forced, and sorting is limited to identity columns.
    const result = await this.partnersService.findAll(
      {
        ...query,
        role,
        status: [PartnerStatus.ACTIVE],
        includeArchived: false,
        sortBy:
          query.sortBy && CATALOG_SORTABLE_FIELDS.includes(query.sortBy)
            ? query.sortBy
            : undefined,
      },
      { identitySearchOnly: !canSearchContacts(role, scope) },
    );
    return {
      ...result,
      items: result.items.map((row) => projectCatalogRow(row, scope)),
    };
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

  /** Same authority as Archive (SEC-03 H2) — un-archiving is the other half of the soft-delete. */
  @Post(':id/restore')
  @PermissionAction('delete')
  restore(@Param('id') id: string, @CurrentUser() user: JwtPayload) {
    return this.partnersService.restore(id, user.sub);
  }
}
