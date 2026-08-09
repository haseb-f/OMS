import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { PermissionsGuard } from '../auth/guards/permissions.guard';
import { PermissionModule } from '../auth/decorators/permission-module.decorator';
import { PermissionAction } from '../auth/decorators/permission-action.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { JwtPayload } from '../auth/guards/jwt-auth.guard';
import { PermissionsResolverService } from '../permissions/permissions-resolver.service';
import { MasterDataQueryDto } from '../master-data/dto/master-data-query.dto';
import { LeadsService } from './leads.service';
import { LeadAssignmentsService } from './assignments/lead-assignments.service';
import { LeadAutoDistributionService } from './distribution/lead-auto-distribution.service';
import { CreateLeadDto } from './dto/create-lead.dto';
import { UpdateLeadDto } from './dto/update-lead.dto';
import { ArchiveLeadDto } from './dto/archive-lead.dto';
import { BulkAssignLeadsDto } from './dto/bulk-assign-leads.dto';
import { CreateLeadAssignmentDto } from './assignments/dto/create-lead-assignment.dto';

const MANAGE_PERMISSION = 'crm.leads.manage';

/**
 * TASK-061 — every route now requires `crm.leads.*` (previously this
 * controller had no guard at all). §7 "Visibility": Customer Service sees
 * only Leads/Orders assigned to them; a user additionally granted
 * `crm.leads.manage` sees everything and can assign/reassign/bulk-assign.
 */
@Controller('leads')
@UseGuards(JwtAuthGuard, PermissionsGuard)
@PermissionModule('leads')
export class LeadsController {
  constructor(
    private readonly leadsService: LeadsService,
    private readonly leadAssignmentsService: LeadAssignmentsService,
    private readonly leadAutoDistributionService: LeadAutoDistributionService,
    private readonly permissionsResolver: PermissionsResolverService,
  ) {}

  @Post()
  create(@Body() dto: CreateLeadDto, @CurrentUser() user: JwtPayload) {
    return this.leadsService.create(dto, user.sub);
  }

  @Get()
  async findAll(
    @Query() query: MasterDataQueryDto,
    @CurrentUser() user: JwtPayload,
    @Query('customerId') customerId?: string,
  ) {
    const canViewAll = await this.permissionsResolver.hasPermission(
      user.sub,
      MANAGE_PERMISSION,
    );
    return this.leadsService.findAll(
      query,
      canViewAll ? undefined : user.sub,
      customerId,
    );
  }

  /** Powers the Assign dialog's employee picker (§6) — active users granted `crm.leads.edit`. Must stay registered before `:id` or Nest would treat "eligible-assignees" as an id. */
  @Get('eligible-assignees')
  @PermissionAction('manage')
  eligibleAssignees() {
    return this.leadAutoDistributionService.getEligibleEmployees();
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.leadsService.findOne(id);
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() dto: UpdateLeadDto) {
    return this.leadsService.update(id, dto);
  }

  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.leadsService.remove(id);
  }

  // --- Business Operations (beside CRUD) ---

  @Post(':id/assign')
  @PermissionAction('manage')
  assign(@Param('id') id: string, @Body() dto: CreateLeadAssignmentDto) {
    return this.leadAssignmentsService.assign(id, dto);
  }

  /** Manual/Bulk Assignment (§6) — authorized managers only (`crm.leads.manage`). Balance-distributes when no `salesEmployeeId` is given. */
  @Post('bulk-assign')
  @HttpCode(200)
  @PermissionAction('manage')
  async bulkAssign(@Body() dto: BulkAssignLeadsDto) {
    if (dto.salesEmployeeId) {
      for (const leadId of dto.leadIds) {
        await this.leadAssignmentsService.assign(leadId, {
          salesEmployeeId: dto.salesEmployeeId,
        });
      }
    } else {
      await this.leadAutoDistributionService.distributeMany(dto.leadIds);
    }
    return { assigned: dto.leadIds.length };
  }

  @Post(':id/start-follow-up')
  @HttpCode(200)
  @PermissionAction('edit')
  startFollowUp(@Param('id') id: string) {
    return this.leadsService.startFollowUp(id);
  }

  @Post(':id/archive')
  @HttpCode(200)
  @PermissionAction('edit')
  archive(@Param('id') id: string, @Body() dto: ArchiveLeadDto) {
    return this.leadsService.archive(id, dto);
  }

  @Post(':id/mark-paid')
  @HttpCode(200)
  @PermissionAction('edit')
  markPaid(@Param('id') id: string) {
    return this.leadsService.markPaid(id);
  }

  /** Sales Foundation (TASK-037) — now always a no-op for a Lead created after TASK-061 (Customer is linked at creation time already), kept for Leads that predate that change. */
  @Post(':id/convert-to-customer')
  @HttpCode(200)
  @PermissionAction('edit')
  convertToCustomer(@Param('id') id: string, @CurrentUser() user: JwtPayload) {
    return this.leadsService.convertToCustomer(id, user.sub);
  }
}
