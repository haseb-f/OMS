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
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { PermissionsGuard } from '../auth/guards/permissions.guard';
import { PermissionModule } from '../auth/decorators/permission-module.decorator';
import { PermissionAction } from '../auth/decorators/permission-action.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { JwtPayload } from '../auth/guards/jwt-auth.guard';
import { SalesTeamsService } from './sales-teams.service';
import { CreateSalesTeamDto, UpdateSalesTeamDto } from './dto/sales-team.dto';

@Controller('sales-teams')
@UseGuards(JwtAuthGuard, PermissionsGuard)
@PermissionModule('sales-teams')
export class SalesTeamsController {
  constructor(private readonly salesTeams: SalesTeamsService) {}

  @Post()
  create(@Body() dto: CreateSalesTeamDto, @CurrentUser() user: JwtPayload) {
    return this.salesTeams.create(dto, user.sub);
  }

  @Get()
  findAll(@Query('search') search?: string) {
    return this.salesTeams.findAll(search);
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.salesTeams.findOne(id);
  }

  @Patch(':id')
  update(
    @Param('id') id: string,
    @Body() dto: UpdateSalesTeamDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.salesTeams.update(id, dto, user.sub);
  }

  @Post(':id/archive')
  @PermissionAction('delete')
  archive(@Param('id') id: string, @CurrentUser() user: JwtPayload) {
    return this.salesTeams.archive(id, user.sub);
  }

  @Post(':id/restore')
  restore(@Param('id') id: string, @CurrentUser() user: JwtPayload) {
    return this.salesTeams.restore(id, user.sub);
  }
}
