import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { PermissionsGuard } from '../auth/guards/permissions.guard';
import { PermissionModule } from '../auth/decorators/permission-module.decorator';
import { PermissionAction } from '../auth/decorators/permission-action.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { JwtPayload } from '../auth/guards/jwt-auth.guard';
import { LandedCostDocumentsService } from './landed-cost-documents.service';
import { CreateLandedCostDocumentDto } from './dto/create-landed-cost-document.dto';
import { UpdateLandedCostDocumentDto } from './dto/update-landed-cost-document.dto';

@Controller('landed-cost-documents')
@UseGuards(JwtAuthGuard, PermissionsGuard)
@PermissionModule('landed-cost')
export class LandedCostDocumentsController {
  constructor(private readonly service: LandedCostDocumentsService) {}

  @Get()
  findAll() {
    return this.service.findAll();
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.service.findOne(id);
  }

  @Get(':id/allocation-preview')
  previewAllocation(@Param('id') id: string) {
    return this.service.previewAllocation(id);
  }

  @Post()
  @PermissionAction('create')
  create(
    @Body() dto: CreateLandedCostDocumentDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.service.create(dto, user.sub);
  }

  @Patch(':id')
  @PermissionAction('edit')
  update(
    @Param('id') id: string,
    @Body() dto: UpdateLandedCostDocumentDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.service.update(id, dto, user.sub);
  }

  @Post(':id/approve')
  @PermissionAction('approve')
  approve(@Param('id') id: string, @CurrentUser() user: JwtPayload) {
    return this.service.approve(id, user.sub);
  }

  @Post(':id/confirm')
  @PermissionAction('confirm')
  post(@Param('id') id: string, @CurrentUser() user: JwtPayload) {
    return this.service.post(id, user.sub);
  }

  @Post(':id/cancel')
  @PermissionAction('cancel')
  cancel(@Param('id') id: string, @CurrentUser() user: JwtPayload) {
    return this.service.cancel(id, user.sub);
  }
}
