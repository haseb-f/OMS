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
import { LeadDistributionMode } from '@prisma/client';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { PermissionsGuard } from '../auth/guards/permissions.guard';
import { PermissionModule } from '../auth/decorators/permission-module.decorator';
import { PermissionAction } from '../auth/decorators/permission-action.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { JwtPayload } from '../auth/guards/jwt-auth.guard';
import { SalesScopeService } from '../sales-scope/sales-scope.service';
import { LeadsService } from './leads.service';
import { LeadAssignmentsService } from './assignments/lead-assignments.service';
import { LeadAutoDistributionService } from './distribution/lead-auto-distribution.service';
import { CreateLeadDto } from './dto/create-lead.dto';
import { UpdateLeadDto } from './dto/update-lead.dto';
import { ArchiveLeadDto } from './dto/archive-lead.dto';
import { BulkAssignLeadsDto } from './dto/bulk-assign-leads.dto';
import { CreateLeadAssignmentDto } from './assignments/dto/create-lead-assignment.dto';
import { FindLeadsQueryDto } from './dto/find-leads-query.dto';
import { ActivateDistributionDto } from './dto/activate-distribution.dto';
import { CreateLeadFollowUpDto } from './dto/create-lead-follow-up.dto';

@Controller('leads')
@UseGuards(JwtAuthGuard, PermissionsGuard)
@PermissionModule('leads')
export class LeadsController {
  constructor(
    private readonly leadsService: LeadsService,
    private readonly leadAssignmentsService: LeadAssignmentsService,
    private readonly leadAutoDistributionService: LeadAutoDistributionService,
    private readonly salesScope: SalesScopeService,
  ) {}

  @Post()
  create(@Body() dto: CreateLeadDto, @CurrentUser() user: JwtPayload) {
    return this.leadsService.create(dto, user.sub);
  }

  @Get()
  async findAll(
    @Query() query: FindLeadsQueryDto,
    @CurrentUser() user: JwtPayload,
  ) {
    const scope = await this.salesScope.resolve(user.sub);
    return this.leadsService.findAll(query, scope);
  }

  @Get('ids')
  async findAllIds(
    @Query() query: FindLeadsQueryDto,
    @CurrentUser() user: JwtPayload,
  ) {
    const scope = await this.salesScope.resolve(user.sub);
    return this.leadsService.findAllIds(query, scope);
  }

  @Get('unassigned-count')
  async unassignedCount(@CurrentUser() user: JwtPayload) {
    const scope = await this.salesScope.resolve(user.sub);
    return this.leadsService.unassignedCount(scope);
  }

  @Get('eligible-assignees')
  @PermissionAction('manage')
  eligibleAssignees() {
    return this.leadAutoDistributionService.getEligibleEmployees();
  }

  @Get('distribution')
  @PermissionAction('manage')
  distributionSnapshot() {
    return this.leadAutoDistributionService.getPolicySnapshot();
  }

  @Post('distribution/activate')
  @HttpCode(200)
  @PermissionAction('manage')
  activateDistribution(
    @Body() dto: ActivateDistributionDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.leadAutoDistributionService.activate({
      mode: dto.mode,
      teamId: dto.teamId,
      departmentId: dto.departmentId,
      actorId: user.sub,
    });
  }

  @Post('distribution/deactivate')
  @HttpCode(200)
  @PermissionAction('manage')
  deactivateDistribution(@CurrentUser() user: JwtPayload) {
    return this.leadAutoDistributionService.deactivate(user.sub);
  }

  @Post('distribution/activate-continuous')
  @HttpCode(200)
  @PermissionAction('manage')
  activateContinuous(@CurrentUser() user: JwtPayload) {
    return this.leadAutoDistributionService.activate({
      mode: LeadDistributionMode.CONTINUOUS,
      actorId: user.sub,
    });
  }

  @Post('distribution/activate-24h')
  @HttpCode(200)
  @PermissionAction('manage')
  activate24h(@CurrentUser() user: JwtPayload) {
    return this.leadAutoDistributionService.activate({
      mode: LeadDistributionMode.TIME_LIMITED,
      actorId: user.sub,
    });
  }

  @Post('bulk-assign')
  @HttpCode(200)
  @PermissionAction('manage')
  async bulkAssign(
    @Body() dto: BulkAssignLeadsDto,
    @CurrentUser() user: JwtPayload,
  ) {
    const scope = await this.salesScope.resolve(user.sub);
    return this.leadsService.bulkAssign(dto, user.sub, scope);
  }

  @Get(':id')
  async findOne(@Param('id') id: string, @CurrentUser() user: JwtPayload) {
    const scope = await this.salesScope.resolve(user.sub);
    return this.leadsService.findOne(id, scope);
  }

  @Patch(':id')
  async update(
    @Param('id') id: string,
    @Body() dto: UpdateLeadDto,
    @CurrentUser() user: JwtPayload,
  ) {
    const scope = await this.salesScope.resolve(user.sub);
    return this.leadsService.update(id, dto, scope);
  }

  @Delete(':id')
  async remove(@Param('id') id: string, @CurrentUser() user: JwtPayload) {
    const scope = await this.salesScope.resolve(user.sub);
    return this.leadsService.remove(id, scope);
  }

  @Post(':id/assign')
  @PermissionAction('manage')
  async assign(
    @Param('id') id: string,
    @Body() dto: CreateLeadAssignmentDto,
    @CurrentUser() user: JwtPayload,
  ) {
    const scope = await this.salesScope.resolve(user.sub);
    this.salesScope.assertCanAssign(scope);
    const lead = await this.leadsService.findOne(id, scope);
    void lead;
    return this.leadAssignmentsService.assign(id, {
      salesEmployeeId: dto.salesEmployeeId,
      method: 'MANUAL',
      reason: dto.reason,
      actorId: user.sub,
    });
  }

  @Post(':id/first-open')
  @HttpCode(200)
  async firstOpen(@Param('id') id: string, @CurrentUser() user: JwtPayload) {
    const scope = await this.salesScope.resolve(user.sub);
    return this.leadsService.firstOpen(id, user.sub, scope);
  }

  @Post(':id/follow-ups')
  @PermissionAction('edit')
  async addFollowUp(
    @Param('id') id: string,
    @Body() dto: CreateLeadFollowUpDto,
    @CurrentUser() user: JwtPayload,
  ) {
    const scope = await this.salesScope.resolve(user.sub);
    return this.leadsService.addFollowUp(id, dto, user.sub, scope);
  }

  @Get(':id/follow-ups')
  async listFollowUps(
    @Param('id') id: string,
    @CurrentUser() user: JwtPayload,
  ) {
    const scope = await this.salesScope.resolve(user.sub);
    await this.leadsService.findOne(id, scope);
    return this.leadsService.listFollowUps(id);
  }

  @Post(':id/start-follow-up')
  @HttpCode(200)
  @PermissionAction('edit')
  async startFollowUp(
    @Param('id') id: string,
    @CurrentUser() user: JwtPayload,
  ) {
    const scope = await this.salesScope.resolve(user.sub);
    return this.leadsService.startFollowUp(id, scope);
  }

  @Post(':id/archive')
  @HttpCode(200)
  @PermissionAction('edit')
  async archive(
    @Param('id') id: string,
    @Body() dto: ArchiveLeadDto,
    @CurrentUser() user: JwtPayload,
  ) {
    const scope = await this.salesScope.resolve(user.sub);
    return this.leadsService.archive(id, dto, scope);
  }

  @Post(':id/mark-paid')
  @HttpCode(200)
  @PermissionAction('edit')
  markQualifiedFromPayment() {
    return this.leadsService.markQualifiedFromPayment();
  }

  @Post(':id/convert-to-customer')
  @HttpCode(200)
  @PermissionAction('edit')
  convertToCustomer() {
    return this.leadsService.convertToCustomer();
  }
}
