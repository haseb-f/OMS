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
import { CostComponentsService } from './cost-components.service';
import { CreateCostComponentDto } from './dto/create-cost-component.dto';
import { UpdateCostComponentDto } from './dto/update-cost-component.dto';
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

@Controller('cost-components')
@UseGuards(JwtAuthGuard, PermissionsGuard)
@PermissionModule('cost-components')
export class CostComponentsController {
  constructor(private readonly costComponentsService: CostComponentsService) {}

  @Post()
  create(@Body() dto: CreateCostComponentDto, @CurrentUser() user: JwtPayload) {
    return this.costComponentsService.create(dto, user.sub);
  }

  @Get()
  @SkipPermissionCheck()
  findAll(@Query() query: MasterDataQueryDto) {
    return this.costComponentsService.findAll(query);
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.costComponentsService.findOne(id);
  }

  @Get(':id/activity')
  activity(@Param('id') id: string) {
    return this.costComponentsService.activityFor(id);
  }

  @Patch(':id')
  update(
    @Param('id') id: string,
    @Body() dto: UpdateCostComponentDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.costComponentsService.update(id, dto, user.sub);
  }

  @Post(':id/archive')
  @PermissionAction('delete')
  archive(@Param('id') id: string, @CurrentUser() user: JwtPayload) {
    return this.costComponentsService.archive(id, user.sub);
  }

  @Post(':id/restore')
  restore(@Param('id') id: string, @CurrentUser() user: JwtPayload) {
    return this.costComponentsService.restore(id, user.sub);
  }
}
