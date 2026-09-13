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
import { InvestmentSalesAllocationService } from './investment-sales-allocation.service';
import { InvestmentReallocationService } from './investment-reallocation.service';
import { ManualAllocateDto } from './dto/manual-allocate.dto';
import { ReverseAllocationDto } from './dto/reverse-allocation.dto';
import { RecordReturnDto } from './dto/record-return.dto';
import { FindAllocationsQueryDto } from './dto/find-allocations-query.dto';
import { RequestReallocationDto } from './dto/request-reallocation.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { PermissionsGuard } from '../auth/guards/permissions.guard';
import { PermissionModule } from '../auth/decorators/permission-module.decorator';
import { PermissionAction } from '../auth/decorators/permission-action.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { JwtPayload } from '../auth/guards/jwt-auth.guard';
import type { ReallocationStatus } from '@prisma/client';

/** Investor Engine Milestone 2, Phase 2-13/36-45/48 — attributes real OMS sales to Investment Opportunities; no double counting, backend-authoritative. */
@Controller('investment-sales')
@UseGuards(JwtAuthGuard, PermissionsGuard)
@PermissionModule('investment-sales')
export class InvestmentSalesController {
  constructor(
    private readonly allocationService: InvestmentSalesAllocationService,
    private readonly reallocationService: InvestmentReallocationService,
  ) {}

  @Get()
  findAll(@Query() query: FindAllocationsQueryDto) {
    return this.allocationService.findAll(query);
  }

  @Get('opportunities/:opportunityId/summary')
  summary(@Param('opportunityId') opportunityId: string) {
    return this.allocationService.getOpportunitySummary(opportunityId);
  }

  @Get('opportunity-products/:opportunityProductId/metrics')
  productMetrics(@Param('opportunityProductId') opportunityProductId: string) {
    return this.allocationService.getProductMetrics(opportunityProductId);
  }

  @Get(':allocationId/activity')
  activity(@Param('allocationId') allocationId: string) {
    return this.allocationService.activityFor(allocationId);
  }

  @Post('allocate/:storeOrderId')
  @HttpCode(200)
  @PermissionAction('manage')
  allocateForOrder(
    @Param('storeOrderId') storeOrderId: string,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.allocationService.allocateForStoreOrder(storeOrderId, user.sub);
  }

  /** Phase 9 — the admin "Recalculate / Allocate Eligible Sales" operation. */
  @Post('recalculate')
  @HttpCode(200)
  @PermissionAction('manage')
  recalculate(@CurrentUser() user: JwtPayload) {
    return this.allocationService.recalculate(user.sub);
  }

  /** Phase 48 — controlled manual allocation. */
  @Post('manual')
  @PermissionAction('manage')
  manualAllocate(
    @Body() dto: ManualAllocateDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.allocationService.manualAllocate(dto, user.sub);
  }

  @Post(':allocationId/reverse')
  @HttpCode(200)
  @PermissionAction('manage')
  reverse(
    @Param('allocationId') allocationId: string,
    @Body() dto: ReverseAllocationDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.allocationService.reverseAllocation(
      allocationId,
      dto,
      user.sub,
    );
  }

  @Post(':allocationId/return')
  @HttpCode(200)
  @PermissionAction('manage')
  recordReturn(
    @Param('allocationId') allocationId: string,
    @Body() dto: RecordReturnDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.allocationService.recordReturn(allocationId, dto, user.sub);
  }

  // -- Cross-Opportunity Reallocation (Phase 39-43) -----------------------

  @Get('reallocations')
  findReallocations(
    @Query('opportunityId') opportunityId?: string,
    @Query('status') status?: ReallocationStatus,
  ) {
    return this.reallocationService.findAll({ opportunityId, status });
  }

  @Get('reallocations/:id')
  findReallocation(@Param('id') id: string) {
    return this.reallocationService.findOne(id);
  }

  @Post('reallocations')
  @PermissionAction('reallocate')
  requestReallocation(
    @Body() dto: RequestReallocationDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.reallocationService.request(dto, user.sub);
  }

  @Post('reallocations/:id/approve')
  @HttpCode(200)
  @PermissionAction('reallocate')
  approveReallocation(
    @Param('id') id: string,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.reallocationService.approve(id, user.sub);
  }

  @Post('reallocations/:id/reject')
  @HttpCode(200)
  @PermissionAction('reallocate')
  rejectReallocation(@Param('id') id: string, @CurrentUser() user: JwtPayload) {
    return this.reallocationService.reject(id, user.sub);
  }
}
