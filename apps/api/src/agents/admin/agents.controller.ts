import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Put,
  Query,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import type { JwtPayload } from '../../auth/guards/jwt-auth.guard';
import { PermissionsGuard } from '../../auth/guards/permissions.guard';
import { PermissionModule } from '../../auth/decorators/permission-module.decorator';
import { PermissionAction } from '../../auth/decorators/permission-action.decorator';
import { CurrentUser } from '../../auth/decorators/current-user.decorator';
import { AgentsService } from './agents.service';
import { AgentAgreementsService } from './agent-agreements.service';
import { AgentDestinationsService } from './agent-destinations.service';
import {
  AgentStockQueryDto,
  CreateAgentDto,
  FindAgentsQueryDto,
  UpdateAgentDto,
} from './dto/agent.dto';
import {
  CreateAgreementDto,
  EndAgreementDto,
  UpdateAgreementDto,
  UpsertShippingRateDto,
} from './dto/agreement.dto';
import { CreatePaymentDestinationDto } from './dto/destination.dto';

/**
 * Internal Agents workspace API (spec §10). Internal-only: `JwtAuthGuard`
 * rejects agent tokens here (no `@AgentPortal()` metadata).
 * Permissions: `agents.view|create|edit`, archive = `agents.archive`,
 * agreements = `agents.agreements.manage`.
 */
@Controller('agents')
@UseGuards(JwtAuthGuard, PermissionsGuard)
@PermissionModule('agents')
export class AgentsController {
  constructor(
    private readonly agents: AgentsService,
    private readonly agreements: AgentAgreementsService,
    private readonly destinations: AgentDestinationsService,
  ) {}

  @Get()
  findAll(@Query() query: FindAgentsQueryDto) {
    return this.agents.findAll(query);
  }

  @Post()
  create(@Body() dto: CreateAgentDto, @CurrentUser() user: JwtPayload) {
    return this.agents.create(dto, user.sub);
  }

  @Get(':id')
  findOne(@Param('id', ParseUUIDPipe) id: string) {
    return this.agents.findOne(id);
  }

  @Patch(':id')
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateAgentDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.agents.update(id, dto, user.sub);
  }

  @Post(':id/activate')
  @PermissionAction('edit')
  activate(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.agents.setStatus(id, 'ACTIVE', user.sub);
  }

  @Post(':id/deactivate')
  @PermissionAction('edit')
  deactivate(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.agents.setStatus(id, 'INACTIVE', user.sub);
  }

  @Post(':id/archive')
  @PermissionAction('delete')
  archive(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.agents.archive(id, user.sub);
  }

  /** Products & stock tab — on-hand/reserved/available/shipped/returned. */
  @Get(':id/stock')
  stock(
    @Param('id', ParseUUIDPipe) id: string,
    @Query() query: AgentStockQueryDto,
  ) {
    return this.agents.getStock(id, query);
  }

  // ── Agreements ──────────────────────────────────────────────────────────

  @Get(':id/agreements')
  listAgreements(@Param('id', ParseUUIDPipe) id: string) {
    return this.agreements.list(id);
  }

  @Get(':id/agreements/:agreementId')
  findAgreement(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('agreementId', ParseUUIDPipe) agreementId: string,
  ) {
    return this.agreements.findOne(id, agreementId);
  }

  @Post(':id/agreements')
  @PermissionAction('manage')
  createAgreement(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CreateAgreementDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.agreements.create(id, dto, user.sub);
  }

  @Patch(':id/agreements/:agreementId')
  @PermissionAction('manage')
  updateAgreement(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('agreementId', ParseUUIDPipe) agreementId: string,
    @Body() dto: UpdateAgreementDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.agreements.update(id, agreementId, dto, user.sub);
  }

  @Post(':id/agreements/:agreementId/activate')
  @PermissionAction('manage')
  activateAgreement(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('agreementId', ParseUUIDPipe) agreementId: string,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.agreements.activate(id, agreementId, user.sub);
  }

  @Post(':id/agreements/:agreementId/end')
  @PermissionAction('manage')
  endAgreement(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('agreementId', ParseUUIDPipe) agreementId: string,
    @Body() dto: EndAgreementDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.agreements.end(id, agreementId, dto, user.sub);
  }

  @Put(':id/agreements/:agreementId/shipping-rates')
  @PermissionAction('manage')
  upsertShippingRate(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('agreementId', ParseUUIDPipe) agreementId: string,
    @Body() dto: UpsertShippingRateDto,
  ) {
    return this.agreements.upsertShippingRate(id, agreementId, dto);
  }

  @Delete(':id/agreements/:agreementId/shipping-rates/:rateId')
  @PermissionAction('manage')
  removeShippingRate(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('agreementId', ParseUUIDPipe) agreementId: string,
    @Param('rateId', ParseUUIDPipe) rateId: string,
  ) {
    return this.agreements.removeShippingRate(id, agreementId, rateId);
  }

  // ── Payment destinations ────────────────────────────────────────────────

  @Get(':id/payment-destinations')
  listDestinations(@Param('id', ParseUUIDPipe) id: string) {
    return this.destinations.list(id);
  }

  @Post(':id/payment-destinations')
  @PermissionAction('edit')
  createDestination(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CreatePaymentDestinationDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.destinations.create(id, dto, user.sub);
  }

  @Post(':id/payment-destinations/:destinationId/deactivate')
  @PermissionAction('edit')
  deactivateDestination(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('destinationId', ParseUUIDPipe) destinationId: string,
  ) {
    return this.destinations.setActive(id, destinationId, false);
  }

  @Post(':id/payment-destinations/:destinationId/activate')
  @PermissionAction('edit')
  activateDestination(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('destinationId', ParseUUIDPipe) destinationId: string,
  ) {
    return this.destinations.setActive(id, destinationId, true);
  }
}
