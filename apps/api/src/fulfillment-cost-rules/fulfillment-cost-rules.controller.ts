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
import { FulfillmentCostRulesService } from './fulfillment-cost-rules.service';
import { CreateFulfillmentCostRuleDto } from './dto/create-fulfillment-cost-rule.dto';
import { UpdateFulfillmentCostRuleDto } from './dto/update-fulfillment-cost-rule.dto';
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

/** ADR-0018 (Order Economics M2.2). Administrator can: Create, Edit, Archive. */
@Controller('fulfillment-cost-rules')
@UseGuards(JwtAuthGuard, PermissionsGuard)
@PermissionModule('fulfillment-cost-rules')
export class FulfillmentCostRulesController {
  constructor(
    private readonly fulfillmentCostRulesService: FulfillmentCostRulesService,
  ) {}

  @Post()
  create(
    @Body() dto: CreateFulfillmentCostRuleDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.fulfillmentCostRulesService.create(dto, user.sub);
  }

  @Get()
  @SkipPermissionCheck()
  findAll(@Query() query: MasterDataQueryDto) {
    return this.fulfillmentCostRulesService.findAll(query);
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.fulfillmentCostRulesService.findOne(id);
  }

  @Get(':id/activity')
  activity(@Param('id') id: string) {
    return this.fulfillmentCostRulesService.activityFor(id);
  }

  @Patch(':id')
  update(
    @Param('id') id: string,
    @Body() dto: UpdateFulfillmentCostRuleDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.fulfillmentCostRulesService.update(id, dto, user.sub);
  }

  @Post(':id/archive')
  @PermissionAction('delete')
  archive(@Param('id') id: string, @CurrentUser() user: JwtPayload) {
    return this.fulfillmentCostRulesService.archive(id, user.sub);
  }

  @Post(':id/restore')
  restore(@Param('id') id: string, @CurrentUser() user: JwtPayload) {
    return this.fulfillmentCostRulesService.restore(id, user.sub);
  }
}
