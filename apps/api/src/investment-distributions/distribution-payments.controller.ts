import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { DistributionPaymentsService } from './distribution-payments.service';
import { CreateDistributionPaymentDto } from './dto/create-distribution-payment.dto';
import { FindDistributionPaymentsQueryDto } from './dto/find-distribution-payments-query.dto';
import { RejectDistributionPaymentDto } from './dto/reject-distribution-payment.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { PermissionsGuard } from '../auth/guards/permissions.guard';
import { PermissionModule } from '../auth/decorators/permission-module.decorator';
import { PermissionAction } from '../auth/decorators/permission-action.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { JwtPayload } from '../auth/guards/jwt-auth.guard';

/** Investor Engine Milestone 3, Phases 8-12/23/42/52/66 — recording and confirming actual Investor profit payouts. */
@Controller('investment-payments')
@UseGuards(JwtAuthGuard, PermissionsGuard)
@PermissionModule('investment-payments')
export class DistributionPaymentsController {
  constructor(private readonly paymentsService: DistributionPaymentsService) {}

  @Get()
  findAll(@Query() query: FindDistributionPaymentsQueryDto) {
    return this.paymentsService.findAll(query);
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.paymentsService.findOne(id);
  }

  @Get(':id/activity')
  activity(@Param('id') id: string) {
    return this.paymentsService.activityFor(id);
  }

  @Post()
  @HttpCode(201)
  create(
    @Body() dto: CreateDistributionPaymentDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.paymentsService.create(dto, user.sub);
  }

  @Post(':id/confirm')
  @HttpCode(200)
  @PermissionAction('confirm')
  confirm(@Param('id') id: string, @CurrentUser() user: JwtPayload) {
    return this.paymentsService.confirm(id, user.sub);
  }

  @Post(':id/reject')
  @HttpCode(200)
  @PermissionAction('cancel')
  reject(
    @Param('id') id: string,
    @Body() dto: RejectDistributionPaymentDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.paymentsService.reject(id, dto.reason, user.sub);
  }

  @Post(':id/cancel')
  @HttpCode(200)
  @PermissionAction('cancel')
  cancel(@Param('id') id: string, @CurrentUser() user: JwtPayload) {
    return this.paymentsService.cancel(id, user.sub);
  }
}
