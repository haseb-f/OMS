import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  Post,
  Query,
  UseGuards,
  UseInterceptors,
  UploadedFile,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import { CapitalContributionsService } from './capital-contributions.service';
import { CreateCapitalContributionDto } from './dto/create-capital-contribution.dto';
import { FindCapitalContributionsQueryDto } from './dto/find-capital-contributions-query.dto';
import { RejectCapitalContributionDto } from './dto/reject-capital-contribution.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { PermissionsGuard } from '../auth/guards/permissions.guard';
import { PermissionModule } from '../auth/decorators/permission-module.decorator';
import { PermissionAction } from '../auth/decorators/permission-action.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { JwtPayload } from '../auth/guards/jwt-auth.guard';
import { ATTACHMENT_MAX_BYTES } from '../common/storage/file-validation';
import { AttachmentsService } from '../common/storage/attachments.service';

/** Investor Engine Milestone 1, Phase 12/29 — one traceable funding movement against a Subscription; Confirm is Finance's authority. */
@Controller('capital-contributions')
@UseGuards(JwtAuthGuard, PermissionsGuard)
@PermissionModule('capital-contributions')
export class CapitalContributionsController {
  constructor(
    private readonly contributionsService: CapitalContributionsService,
    private readonly attachments: AttachmentsService,
  ) {}

  @Post()
  create(
    @Body() dto: CreateCapitalContributionDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.contributionsService.create(dto, user.sub);
  }

  @Get()
  findAll(@Query() query: FindCapitalContributionsQueryDto) {
    return this.contributionsService.findAll(query);
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.contributionsService.findOne(id);
  }

  @Get(':id/activity')
  activity(@Param('id') id: string) {
    return this.contributionsService.activityFor(id);
  }

  @Post(':id/confirm')
  @HttpCode(200)
  @PermissionAction('confirm')
  confirm(@Param('id') id: string, @CurrentUser() user: JwtPayload) {
    return this.contributionsService.confirm(id, user.sub);
  }

  @Post(':id/reject')
  @HttpCode(200)
  @PermissionAction('cancel')
  reject(
    @Param('id') id: string,
    @Body() dto: RejectCapitalContributionDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.contributionsService.reject(id, dto.reason, user.sub);
  }

  @Post(':id/cancel')
  @HttpCode(200)
  @PermissionAction('cancel')
  cancel(@Param('id') id: string, @CurrentUser() user: JwtPayload) {
    return this.contributionsService.cancel(id, user.sub);
  }

  @Post(':id/attachments/from-staging')
  @HttpCode(200)
  attachStaging(
    @Param('id') id: string,
    @Body() body: { stagingAttachmentIds?: string[] },
    @CurrentUser() user: JwtPayload,
  ) {
    return this.attachments.attachStagingToContribution(
      id,
      body.stagingAttachmentIds ?? [],
      user.sub,
    );
  }

  @Post(':id/attachments/upload')
  @UseInterceptors(
    FileInterceptor('file', {
      storage: memoryStorage(),
      limits: { fileSize: ATTACHMENT_MAX_BYTES },
    }),
  )
  uploadReceipt(
    @Param('id') id: string,
    @UploadedFile() file: Express.Multer.File | undefined,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.attachments.uploadForContribution(id, file, user.sub);
  }

  @Get(':id/attachments')
  listAttachments(@Param('id') id: string) {
    return this.attachments.listForContribution(id);
  }
}
