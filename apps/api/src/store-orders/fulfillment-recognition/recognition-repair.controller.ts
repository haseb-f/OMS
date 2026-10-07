import { Body, Controller, HttpCode, Post, UseGuards } from '@nestjs/common';
import { IsArray, IsBoolean, IsOptional, IsUUID } from 'class-validator';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import type { JwtPayload } from '../../auth/guards/jwt-auth.guard';
import { PermissionsGuard } from '../../auth/guards/permissions.guard';
import { PermissionModule } from '../../auth/decorators/permission-module.decorator';
import { PermissionAction } from '../../auth/decorators/permission-action.decorator';
import { CurrentUser } from '../../auth/decorators/current-user.decorator';
import { RecognitionRepairService } from './recognition-repair.service';

export class RecognitionRepairDto {
  /** Default true — only an explicit `false` applies (super admin only). */
  @IsOptional()
  @IsBoolean()
  dryRun?: boolean;

  /** Limit the repair to these orders (default: every delivered order). */
  @IsOptional()
  @IsArray()
  @IsUUID('all', { each: true })
  orderIds?: string[];
}

/**
 * R14 W3 (spec-3 §6) — the recognition repair behind an endpoint: a dry run
 * for anyone allowed to generate store-order invoices, apply for a super
 * admin only (it creates invoices, movements and journals — decision D3-2).
 */
@Controller('store-orders/recognition-repair')
@UseGuards(JwtAuthGuard, PermissionsGuard)
@PermissionModule('store-orders')
export class RecognitionRepairController {
  constructor(private readonly repair: RecognitionRepairService) {}

  @Post()
  @HttpCode(200)
  @PermissionAction('generate_invoice')
  async run(
    @Body() dto: RecognitionRepairDto,
    @CurrentUser() user: JwtPayload,
  ) {
    const dryRun = dto.dryRun !== false;
    if (!dryRun) await this.repair.assertMayApply(user.sub);
    return this.repair.run({
      dryRun,
      userId: user.sub,
      orderIds: dto.orderIds,
    });
  }
}
