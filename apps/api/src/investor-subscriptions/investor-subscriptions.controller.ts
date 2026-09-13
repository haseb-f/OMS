import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { InvestorSubscriptionsService } from './investor-subscriptions.service';
import { CreateInvestorSubscriptionDto } from './dto/create-investor-subscription.dto';
import { UpdateInvestorSubscriptionDto } from './dto/update-investor-subscription.dto';
import { FindInvestorSubscriptionsQueryDto } from './dto/find-investor-subscriptions-query.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { PermissionsGuard } from '../auth/guards/permissions.guard';
import { PermissionModule } from '../auth/decorators/permission-module.decorator';
import { PermissionAction } from '../auth/decorators/permission-action.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { JwtPayload } from '../auth/guards/jwt-auth.guard';

/** Investor Engine Milestone 1, Phase 9/28 — an Investor's subscription to an Opportunity, managed mainly from within the Opportunity/Investor workspaces. */
@Controller('investor-subscriptions')
@UseGuards(JwtAuthGuard, PermissionsGuard)
@PermissionModule('investor-subscriptions')
export class InvestorSubscriptionsController {
  constructor(
    private readonly subscriptionsService: InvestorSubscriptionsService,
  ) {}

  @Post()
  create(
    @Body() dto: CreateInvestorSubscriptionDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.subscriptionsService.create(dto, user.sub);
  }

  @Get()
  findAll(@Query() query: FindInvestorSubscriptionsQueryDto) {
    return this.subscriptionsService.findAll(query);
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.subscriptionsService.findOne(id);
  }

  @Patch(':id')
  update(
    @Param('id') id: string,
    @Body() dto: UpdateInvestorSubscriptionDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.subscriptionsService.update(id, dto, user.sub);
  }

  @Post(':id/cancel')
  @HttpCode(200)
  @PermissionAction('edit')
  cancel(@Param('id') id: string, @CurrentUser() user: JwtPayload) {
    return this.subscriptionsService.cancel(id, user.sub);
  }
}
