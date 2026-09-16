import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  Post,
  Query,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import type { CarrierReconciliationState } from '@prisma/client';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { PermissionsGuard } from '../auth/guards/permissions.guard';
import { PermissionModule } from '../auth/decorators/permission-module.decorator';
import { PermissionAction } from '../auth/decorators/permission-action.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { JwtPayload } from '../auth/guards/jwt-auth.guard';
import { CarrierReconciliationService } from './carrier-reconciliation.service';
import { MatchCarrierChargeDto } from './dto/match-carrier-charge.dto';

const IMPORT_MAX_BYTES = 5 * 1024 * 1024;

/** ADR-0018 (Order Economics M2 gap closure) — its own module, deliberately separate from `shipping.*` (see permission-catalog.ts). */
@Controller('carrier-reconciliation')
@UseGuards(JwtAuthGuard, PermissionsGuard)
@PermissionModule('carrier-reconciliation')
export class CarrierReconciliationController {
  constructor(private readonly service: CarrierReconciliationService) {}

  @Post('import')
  @PermissionAction('import')
  @UseInterceptors(
    FileInterceptor('file', {
      storage: memoryStorage(),
      limits: { fileSize: IMPORT_MAX_BYTES },
    }),
  )
  async importCsv(
    @UploadedFile() file: Express.Multer.File | undefined,
    @CurrentUser() user: JwtPayload,
  ) {
    if (!file) {
      throw new BadRequestException('No file uploaded.');
    }
    return this.service.importCsv(
      file.buffer.toString('utf-8'),
      file.originalname,
      user.sub,
    );
  }

  @Get()
  @PermissionAction('view')
  findAll(
    @Query()
    query: {
      state?: CarrierReconciliationState;
      search?: string;
      page?: string;
      pageSize?: string;
    },
  ) {
    return this.service.findAll({
      state: query.state,
      search: query.search,
      page: query.page ? Number(query.page) : undefined,
      pageSize: query.pageSize ? Number(query.pageSize) : undefined,
    });
  }

  @Get('shipment-candidates')
  @PermissionAction('match')
  findShipmentCandidates(@Query('orderNumber') orderNumber: string) {
    if (!orderNumber?.trim()) {
      throw new BadRequestException('orderNumber is required.');
    }
    return this.service.findShipmentCandidatesByOrderNumber(orderNumber);
  }

  @Get(':id')
  @PermissionAction('view')
  findOne(@Param('id') id: string) {
    return this.service.findOne(id);
  }

  @Get(':id/activity')
  @PermissionAction('view')
  activity(@Param('id') id: string) {
    return this.service.activityFor(id);
  }

  @Post(':id/match')
  @HttpCode(200)
  @PermissionAction('match')
  match(
    @Param('id') id: string,
    @Body() dto: MatchCarrierChargeDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.service.match(id, dto.shipmentId, user.sub);
  }

  @Post(':id/unmatch')
  @HttpCode(200)
  @PermissionAction('match')
  unmatch(@Param('id') id: string, @CurrentUser() user: JwtPayload) {
    return this.service.unmatch(id, user.sub);
  }

  @Post(':id/confirm')
  @HttpCode(200)
  @PermissionAction('confirm')
  confirm(@Param('id') id: string, @CurrentUser() user: JwtPayload) {
    return this.service.confirm(id, user.sub);
  }
}
