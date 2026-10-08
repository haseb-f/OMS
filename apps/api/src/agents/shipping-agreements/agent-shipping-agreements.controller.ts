import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import type { JwtPayload } from '../../auth/guards/jwt-auth.guard';
import { PermissionsGuard } from '../../auth/guards/permissions.guard';
import { PermissionModule } from '../../auth/decorators/permission-module.decorator';
import { PermissionAction } from '../../auth/decorators/permission-action.decorator';
import { CurrentUser } from '../../auth/decorators/current-user.decorator';
import { AgentShippingAgreementsService } from './agent-shipping-agreements.service';
import {
  ActivateShippingAgreementDto,
  CreateShippingAgreementDto,
  DeactivateShippingAgreementDto,
  DuplicateShippingAgreementDto,
  ShippingAgreementRateDto,
  UpdateShippingAgreementDto,
} from './dto/shipping-agreement.dto';

/**
 * Agent → Settings → Shipping agreement (R15 D15-13). Internal-only
 * (`JwtAuthGuard` rejects agent tokens: no `@AgentPortal()`); reads =
 * `agents.view`, every write = `agents.agreements.manage`.
 */
@Controller('agents/:agentId/shipping-agreements')
@UseGuards(JwtAuthGuard, PermissionsGuard)
@PermissionModule('agents')
export class AgentShippingAgreementsController {
  constructor(private readonly agreements: AgentShippingAgreementsService) {}

  @Get()
  list(@Param('agentId', ParseUUIDPipe) agentId: string) {
    return this.agreements.list(agentId);
  }

  @Get(':id')
  findOne(
    @Param('agentId', ParseUUIDPipe) agentId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.agreements.findOne(agentId, id);
  }

  @Post()
  @PermissionAction('manage')
  create(
    @Param('agentId', ParseUUIDPipe) agentId: string,
    @Body() dto: CreateShippingAgreementDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.agreements.create(agentId, dto, user.sub);
  }

  @Patch(':id')
  @PermissionAction('manage')
  update(
    @Param('agentId', ParseUUIDPipe) agentId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateShippingAgreementDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.agreements.update(agentId, id, dto, user.sub);
  }

  @Post(':id/rates')
  @PermissionAction('manage')
  addRate(
    @Param('agentId', ParseUUIDPipe) agentId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ShippingAgreementRateDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.agreements.addRate(agentId, id, dto, user.sub);
  }

  @Patch(':id/rates/:rateId')
  @PermissionAction('manage')
  updateRate(
    @Param('agentId', ParseUUIDPipe) agentId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('rateId', ParseUUIDPipe) rateId: string,
    @Body() dto: ShippingAgreementRateDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.agreements.updateRate(agentId, id, rateId, dto, user.sub);
  }

  @Delete(':id/rates/:rateId')
  @PermissionAction('manage')
  removeRate(
    @Param('agentId', ParseUUIDPipe) agentId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('rateId', ParseUUIDPipe) rateId: string,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.agreements.removeRate(agentId, id, rateId, user.sub);
  }

  @Post(':id/discard')
  @PermissionAction('manage')
  discard(
    @Param('agentId', ParseUUIDPipe) agentId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.agreements.discard(agentId, id, user.sub);
  }

  @Post(':id/duplicate')
  @PermissionAction('manage')
  duplicate(
    @Param('agentId', ParseUUIDPipe) agentId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: DuplicateShippingAgreementDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.agreements.duplicate(agentId, id, dto, user.sub);
  }

  @Post(':id/activate')
  @PermissionAction('manage')
  activate(
    @Param('agentId', ParseUUIDPipe) agentId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ActivateShippingAgreementDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.agreements.activate(agentId, id, dto, user.sub);
  }

  @Post(':id/deactivate')
  @PermissionAction('manage')
  deactivate(
    @Param('agentId', ParseUUIDPipe) agentId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: DeactivateShippingAgreementDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.agreements.deactivate(agentId, id, dto, user.sub);
  }
}
