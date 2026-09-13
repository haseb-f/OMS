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
  UseInterceptors,
  UploadedFile,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import { InvestmentExpensesService } from './investment-expenses.service';
import { CreateOpportunityExpenseDto } from './dto/create-opportunity-expense.dto';
import { UpdateOpportunityExpenseDto } from './dto/update-opportunity-expense.dto';
import { FindOpportunityExpensesQueryDto } from './dto/find-opportunity-expenses-query.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { PermissionsGuard } from '../auth/guards/permissions.guard';
import { PermissionModule } from '../auth/decorators/permission-module.decorator';
import { PermissionAction } from '../auth/decorators/permission-action.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { JwtPayload } from '../auth/guards/jwt-auth.guard';
import { ATTACHMENT_MAX_BYTES } from '../common/storage/file-validation';
import { AttachmentsService } from '../common/storage/attachments.service';

/** Investor Engine Milestone 2, Phase 15-18/29 — Opportunity-level expenses; only APPROVED expenses affect authoritative Net Profit. */
@Controller('investment-expenses')
@UseGuards(JwtAuthGuard, PermissionsGuard)
@PermissionModule('investment-expenses')
export class InvestmentExpensesController {
  constructor(
    private readonly expensesService: InvestmentExpensesService,
    private readonly attachments: AttachmentsService,
  ) {}

  @Post()
  create(
    @Body() dto: CreateOpportunityExpenseDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.expensesService.create(dto, user.sub);
  }

  @Get()
  findAll(@Query() query: FindOpportunityExpensesQueryDto) {
    return this.expensesService.findAll(query);
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.expensesService.findOne(id);
  }

  @Get(':id/activity')
  activity(@Param('id') id: string) {
    return this.expensesService.activityFor(id);
  }

  @Patch(':id')
  update(
    @Param('id') id: string,
    @Body() dto: UpdateOpportunityExpenseDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.expensesService.update(id, dto, user.sub);
  }

  @Post(':id/approve')
  @HttpCode(200)
  @PermissionAction('approve')
  approve(@Param('id') id: string, @CurrentUser() user: JwtPayload) {
    return this.expensesService.approve(id, user.sub);
  }

  @Post(':id/reject')
  @HttpCode(200)
  @PermissionAction('approve')
  reject(@Param('id') id: string, @CurrentUser() user: JwtPayload) {
    return this.expensesService.reject(id, user.sub);
  }

  @Post(':id/void')
  @HttpCode(200)
  @PermissionAction('approve')
  void_(@Param('id') id: string, @CurrentUser() user: JwtPayload) {
    return this.expensesService.void(id, user.sub);
  }

  @Post(':id/attachments/from-staging')
  @HttpCode(200)
  attachStaging(
    @Param('id') id: string,
    @Body() body: { stagingAttachmentIds?: string[] },
    @CurrentUser() user: JwtPayload,
  ) {
    return this.attachments.attachStagingToOpportunityExpense(
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
    return this.attachments.uploadForOpportunityExpense(id, file, user.sub);
  }

  @Get(':id/attachments')
  listAttachments(@Param('id') id: string) {
    return this.attachments.listForOpportunityExpense(id);
  }
}
