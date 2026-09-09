import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { CommissionPlansService } from './commission-plans.service';
import { CreateCommissionPlanDto } from './dto/create-commission-plan.dto';
import { UpdateCommissionPlanDto } from './dto/update-commission-plan.dto';
import { AssignCommissionPlanDto } from './dto/assign-commission-plan.dto';
import { MasterDataQueryDto } from '../master-data/dto/master-data-query.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { PermissionsGuard } from '../auth/guards/permissions.guard';
import { PermissionModule } from '../auth/decorators/permission-module.decorator';
import { PermissionAction } from '../auth/decorators/permission-action.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { JwtPayload } from '../auth/guards/jwt-auth.guard';

/** Part T/U — Commission Plans (rules + tiers + assignment). */
@Controller('commission-plans')
@UseGuards(JwtAuthGuard, PermissionsGuard)
@PermissionModule('commission-plans')
export class CommissionPlansController {
  constructor(private readonly service: CommissionPlansService) {}

  @Post()
  create(
    @Body() dto: CreateCommissionPlanDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.service.create(dto, user.sub);
  }

  @Get()
  findAll(@Query() query: MasterDataQueryDto) {
    return this.service.findAll(query);
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.service.findOne(id);
  }

  @Patch(':id')
  update(
    @Param('id') id: string,
    @Body() dto: UpdateCommissionPlanDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.service.update(id, dto, user.sub);
  }

  @Post(':id/archive')
  @PermissionAction('delete')
  archive(@Param('id') id: string, @CurrentUser() user: JwtPayload) {
    return this.service.archive(id, user.sub);
  }

  @Post(':id/restore')
  restore(@Param('id') id: string, @CurrentUser() user: JwtPayload) {
    return this.service.restore(id, user.sub);
  }

  @Post(':id/assignments')
  assign(
    @Param('id') id: string,
    @Body() dto: AssignCommissionPlanDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.service.assign(id, dto, user.sub);
  }

  @Delete('assignments/:assignmentId')
  unassign(@Param('assignmentId') assignmentId: string) {
    return this.service.unassign(assignmentId);
  }
}
