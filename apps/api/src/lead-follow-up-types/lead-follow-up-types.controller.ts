import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { LeadFollowUpTypesService } from './lead-follow-up-types.service';
import { CreateLeadFollowUpTypeDto } from './dto/create-lead-follow-up-type.dto';
import { UpdateLeadFollowUpTypeDto } from './dto/update-lead-follow-up-type.dto';
import { MasterDataQueryDto } from '../master-data/dto/master-data-query.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { PermissionsGuard } from '../auth/guards/permissions.guard';
import { PermissionModule } from '../auth/decorators/permission-module.decorator';
import {
  PermissionAction,
  SkipPermissionCheck,
} from '../auth/decorators/permission-action.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { JwtPayload } from '../auth/guards/jwt-auth.guard';

@Controller('lead-follow-up-types')
@UseGuards(JwtAuthGuard, PermissionsGuard)
@PermissionModule('lead-follow-up-types')
export class LeadFollowUpTypesController {
  constructor(
    private readonly leadFollowUpTypesService: LeadFollowUpTypesService,
  ) {}

  @Post()
  create(
    @Body() dto: CreateLeadFollowUpTypeDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.leadFollowUpTypesService.create(dto, user.sub);
  }

  @Get()
  @SkipPermissionCheck()
  findAll(@Query() query: MasterDataQueryDto) {
    return this.leadFollowUpTypesService.findAll(query);
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.leadFollowUpTypesService.findOne(id);
  }

  @Get(':id/activity')
  activity(@Param('id') id: string) {
    return this.leadFollowUpTypesService.activityFor(id);
  }

  @Patch(':id')
  update(
    @Param('id') id: string,
    @Body() dto: UpdateLeadFollowUpTypeDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.leadFollowUpTypesService.update(id, dto, user.sub);
  }

  @Post(':id/archive')
  @PermissionAction('delete')
  archive(@Param('id') id: string, @CurrentUser() user: JwtPayload) {
    return this.leadFollowUpTypesService.archive(id, user.sub);
  }

  @Post(':id/restore')
  restore(@Param('id') id: string, @CurrentUser() user: JwtPayload) {
    return this.leadFollowUpTypesService.restore(id, user.sub);
  }
}
