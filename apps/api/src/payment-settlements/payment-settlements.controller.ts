import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
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
import { PaymentSettlementsService } from './payment-settlements.service';
import {
  CreateSettlementDto,
  ReverseSettlementDto,
  SettlementInputDto,
  SettlementQueryDto,
} from './dto/settle-payments.dto';

/**
 * Batch provider settlement — permissions under the `payment-reconciliation`
 * module: view (read), settle (preview + create), correct (reverse).
 */
@Controller('payment-settlements')
@UseGuards(JwtAuthGuard, PermissionsGuard)
@PermissionModule('payment-reconciliation')
export class PaymentSettlementsController {
  constructor(private readonly service: PaymentSettlementsService) {}

  /** Matched, posted, unsettled claims of one method + totals by currency. */
  @Get('eligible')
  @PermissionAction('view')
  eligible(@Query('paymentMethodId', ParseUUIDPipe) paymentMethodId: string) {
    return this.service.findEligible(paymentMethodId);
  }

  /** Clearing GL balance vs Σ unsettled carrying values (one method, or all linked methods). */
  @Get('provider-balances')
  @PermissionAction('view')
  providerBalances(
    @Query('paymentMethodId', new ParseUUIDPipe({ optional: true }))
    paymentMethodId?: string,
  ) {
    return this.service.providerBalances(paymentMethodId);
  }

  @Post('preview')
  @PermissionAction('settle')
  preview(@Body() dto: SettlementInputDto) {
    return this.service.preview(dto);
  }

  @Post()
  @PermissionAction('settle')
  create(@Body() dto: CreateSettlementDto, @CurrentUser() user: JwtPayload) {
    return this.service.create(dto, user.sub);
  }

  /** Settlement register. */
  @Get()
  @PermissionAction('view')
  findAll(@Query() query: SettlementQueryDto) {
    return this.service.findAll(query);
  }

  @Get(':id')
  @PermissionAction('view')
  findOne(@Param('id', ParseUUIDPipe) id: string) {
    return this.service.findOne(id);
  }

  @Post(':id/reverse')
  @PermissionAction('correct')
  reverse(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ReverseSettlementDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.service.reverse(id, dto.reason, user.sub);
  }
}
