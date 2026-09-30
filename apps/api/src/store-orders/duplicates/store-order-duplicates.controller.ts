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
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import type { JwtPayload } from '../../auth/guards/jwt-auth.guard';
import { PermissionsGuard } from '../../auth/guards/permissions.guard';
import { PermissionModule } from '../../auth/decorators/permission-module.decorator';
import {
  PermissionAction,
  SkipPermissionCheck,
} from '../../auth/decorators/permission-action.decorator';
import { CurrentUser } from '../../auth/decorators/current-user.decorator';
import { StoreOrderDuplicatesService } from './store-order-duplicates.service';
import { StoreOrderDuplicateReviewService } from './store-order-duplicate-review.service';
import {
  DuplicateCheckDto,
  ResolveDuplicateReviewDto,
} from './dto/duplicate.dto';

/**
 * Round 5 Spec 1B — duplicate check for the internal create dialogs, and the
 * cross-scope duplicate review (`store-orders.duplicate_review`). The
 * pending queue itself is the Store Orders list filtered by
 * `duplicateReviewStatus` (same permission).
 */
@Controller('store-orders')
@UseGuards(JwtAuthGuard, PermissionsGuard)
@PermissionModule('store-orders')
export class StoreOrderDuplicatesController {
  constructor(
    private readonly duplicates: StoreOrderDuplicatesService,
    private readonly reviews: StoreOrderDuplicateReviewService,
  ) {}

  /** Any-of order-creating permission, checked in the service (the guard maps one route to one permission). */
  @Post('duplicate-check')
  @HttpCode(200)
  @SkipPermissionCheck()
  async check(@Body() dto: DuplicateCheckDto, @CurrentUser() user: JwtPayload) {
    const scope = await this.duplicates.internalScope(user.sub, dto.agentId);
    return this.duplicates.check(dto, scope);
  }

  @Get(':id/duplicate-review')
  @PermissionAction('duplicate_review')
  reviewDetail(@Param('id', ParseUUIDPipe) id: string) {
    return this.reviews.detail(id);
  }

  @Post(':id/duplicate-review/resolve')
  @HttpCode(200)
  @PermissionAction('duplicate_review')
  resolve(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ResolveDuplicateReviewDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.reviews.resolve(id, dto, user.sub);
  }
}
