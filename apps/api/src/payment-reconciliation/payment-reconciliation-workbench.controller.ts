import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import type { JwtPayload } from '../auth/guards/jwt-auth.guard';
import { PermissionsGuard } from '../auth/guards/permissions.guard';
import { PermissionModule } from '../auth/decorators/permission-module.decorator';
import { PermissionAction } from '../auth/decorators/permission-action.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { PaymentMatchingService } from './payment-matching.service';
import { PaymentBulkAcceptService } from './payment-bulk-accept.service';
import { BulkAcceptMatchesDto } from './dto/bulk-accept-matches.dto';

/**
 * Payment review workbench additions to the reconciliation workspace (Round 5
 * spec 3): the match panel's statement side for one claim, and "Accept strong
 * suggestions". Same `finance.payment-reconciliation.*` permissions as the
 * single-record endpoints they reuse (view to read, match to confirm).
 */
@Controller('payment-reconciliation')
@UseGuards(JwtAuthGuard, PermissionsGuard)
@PermissionModule('payment-reconciliation')
export class PaymentReconciliationWorkbenchController {
  constructor(
    private readonly matching: PaymentMatchingService,
    private readonly bulk: PaymentBulkAcceptService,
  ) {}

  @Get('methods/:methodId/claims/:paymentId/lines')
  @PermissionAction('view')
  claimLines(
    @Param('methodId', ParseUUIDPipe) methodId: string,
    @Param('paymentId', ParseUUIDPipe) paymentId: string,
  ) {
    return this.matching.claimLines(methodId, paymentId);
  }

  @Post('methods/:methodId/matches/bulk-accept')
  @HttpCode(200)
  @PermissionAction('match')
  bulkAccept(
    @Param('methodId', ParseUUIDPipe) methodId: string,
    @Body() dto: BulkAcceptMatchesDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.bulk.bulkAccept(methodId, dto, user.sub);
  }
}
