import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
  Query,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import type { JwtPayload } from '../auth/guards/jwt-auth.guard';
import { PermissionsGuard } from '../auth/guards/permissions.guard';
import { PermissionModule } from '../auth/decorators/permission-module.decorator';
import { PermissionAction } from '../auth/decorators/permission-action.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { PaymentReconciliationService } from './payment-reconciliation.service';
import {
  PaymentStatementsService,
  STATEMENT_MAX_BYTES,
  parseMappingField,
} from './payment-statements.service';
import { PaymentMatchingService } from './payment-matching.service';
import {
  ConfirmMatchDto,
  ConnectSheetDto,
  DismissSuggestionDto,
  FindClaimsQueryDto,
  FindStatementLinesQueryDto,
  ManualStatementLineDto,
  ReasonDto,
} from './dto/payment-reconciliation.dto';

const uploadInterceptor = FileInterceptor('file', {
  storage: memoryStorage(),
  // One file part, capped size and field count (multer rejects beyond → 413).
  limits: { fileSize: STATEMENT_MAX_BYTES, files: 1, fields: 10 },
});

/**
 * Payment reconciliation workspace (payment-declaration-reconciliation §4–5),
 * one per payment method with `requiresReconciliation`. Permissions:
 * view (read), import (statements/sync/manual), match (confirm, reject
 * suggestion, dispute, exceptions), correct (reverse a posted match).
 */
@Controller('payment-reconciliation')
@UseGuards(JwtAuthGuard, PermissionsGuard)
@PermissionModule('payment-reconciliation')
export class PaymentReconciliationController {
  constructor(
    private readonly overview: PaymentReconciliationService,
    private readonly statements: PaymentStatementsService,
    private readonly matching: PaymentMatchingService,
  ) {}

  @Get('methods')
  @PermissionAction('view')
  listMethods() {
    return this.overview.listMethods();
  }

  @Get('methods/:methodId')
  @PermissionAction('view')
  getMethod(@Param('methodId', ParseUUIDPipe) methodId: string) {
    return this.overview.getMethod(methodId);
  }

  @Get('methods/:methodId/lines')
  @PermissionAction('view')
  listLines(
    @Param('methodId', ParseUUIDPipe) methodId: string,
    @Query() query: FindStatementLinesQueryDto,
  ) {
    return this.overview.listLines(methodId, query);
  }

  @Get('methods/:methodId/imports')
  @PermissionAction('view')
  listImports(@Param('methodId', ParseUUIDPipe) methodId: string) {
    return this.statements.listImports(methodId);
  }

  @Get('methods/:methodId/claims')
  @PermissionAction('view')
  awaitingClaims(@Param('methodId', ParseUUIDPipe) methodId: string) {
    return this.matching.awaitingClaims(methodId);
  }

  @Get('methods/:methodId/claims/search')
  @PermissionAction('match')
  searchClaims(
    @Param('methodId', ParseUUIDPipe) methodId: string,
    @Query() query: FindClaimsQueryDto,
  ) {
    return this.matching.searchClaims(methodId, query);
  }

  // -------------------------------------------------------------- statements

  @Post('methods/:methodId/statements/preview')
  @HttpCode(200)
  @PermissionAction('import')
  @UseInterceptors(uploadInterceptor)
  previewFile(
    @Param('methodId', ParseUUIDPipe) methodId: string,
    @UploadedFile() file: Express.Multer.File | undefined,
    @Body('mapping') mapping: string | undefined,
  ) {
    if (!file) throw new BadRequestException('No file uploaded.');
    return this.statements.previewFile(
      methodId,
      file,
      parseMappingField(mapping),
    );
  }

  @Post('methods/:methodId/statements/commit')
  @PermissionAction('import')
  @UseInterceptors(uploadInterceptor)
  commitFile(
    @Param('methodId', ParseUUIDPipe) methodId: string,
    @UploadedFile() file: Express.Multer.File | undefined,
    @Body('mapping') mapping: string | undefined,
    @CurrentUser() user: JwtPayload,
  ) {
    if (!file) throw new BadRequestException('No file uploaded.');
    return this.statements.commitFile(
      methodId,
      file,
      parseMappingField(mapping),
      user.sub,
    );
  }

  @Post('methods/:methodId/lines')
  @PermissionAction('import')
  createManualLine(
    @Param('methodId', ParseUUIDPipe) methodId: string,
    @Body() dto: ManualStatementLineDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.statements.createManualLine(methodId, dto, user.sub);
  }

  @Get('methods/:methodId/sheet-source')
  @PermissionAction('view')
  getSheetSource(@Param('methodId', ParseUUIDPipe) methodId: string) {
    return this.statements.getSheetSource(methodId);
  }

  @Post('methods/:methodId/sheet-source/preview')
  @HttpCode(200)
  @PermissionAction('import')
  previewSheet(
    @Param('methodId', ParseUUIDPipe) methodId: string,
    @Body() dto: ConnectSheetDto,
  ) {
    return this.statements.previewSheet(methodId, dto);
  }

  @Put('methods/:methodId/sheet-source')
  @PermissionAction('import')
  connectSheet(
    @Param('methodId', ParseUUIDPipe) methodId: string,
    @Body() dto: ConnectSheetDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.statements.connectSheet(methodId, dto, user.sub);
  }

  @Post('methods/:methodId/sheet-source/sync')
  @HttpCode(200)
  @PermissionAction('import')
  syncSheet(
    @Param('methodId', ParseUUIDPipe) methodId: string,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.statements.syncSheet(methodId, user.sub);
  }

  // ---------------------------------------------------------------- matching

  @Get('methods/:methodId/lines/:lineId/suggestions')
  @PermissionAction('view')
  suggestions(
    @Param('methodId', ParseUUIDPipe) methodId: string,
    @Param('lineId', ParseUUIDPipe) lineId: string,
  ) {
    return this.matching.suggestions(methodId, lineId);
  }

  @Post('methods/:methodId/matches')
  @HttpCode(200)
  @PermissionAction('match')
  async confirmMatch(
    @Param('methodId', ParseUUIDPipe) methodId: string,
    @Body() dto: ConfirmMatchDto,
    @CurrentUser() user: JwtPayload,
  ) {
    await this.statements.requireReconciledMethod(methodId);
    return this.matching.confirm(methodId, dto, user.sub);
  }

  @Post('methods/:methodId/lines/:lineId/dismiss')
  @HttpCode(200)
  @PermissionAction('match')
  dismissSuggestion(
    @Param('methodId', ParseUUIDPipe) methodId: string,
    @Param('lineId', ParseUUIDPipe) lineId: string,
    @Body() dto: DismissSuggestionDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.matching.dismissSuggestion(
      methodId,
      lineId,
      dto.paymentId,
      dto.reason,
      user.sub,
    );
  }

  @Post('methods/:methodId/claims/:paymentId/dispute')
  @HttpCode(200)
  @PermissionAction('match')
  disputeClaim(
    @Param('methodId', ParseUUIDPipe) methodId: string,
    @Param('paymentId', ParseUUIDPipe) paymentId: string,
    @Body() dto: ReasonDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.matching.disputeClaim(
      methodId,
      paymentId,
      dto.reason,
      user.sub,
    );
  }

  @Post('methods/:methodId/matches/:matchId/reverse')
  @HttpCode(200)
  @PermissionAction('correct')
  reverseMatch(
    @Param('methodId', ParseUUIDPipe) methodId: string,
    @Param('matchId', ParseUUIDPipe) matchId: string,
    @Body() dto: ReasonDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.matching.reverseMatch(methodId, matchId, dto.reason, user.sub);
  }

  // -------------------------------------------------------------- exceptions

  @Post('methods/:methodId/lines/:lineId/ignore')
  @HttpCode(200)
  @PermissionAction('match')
  ignoreLine(
    @Param('methodId', ParseUUIDPipe) methodId: string,
    @Param('lineId', ParseUUIDPipe) lineId: string,
    @Body() dto: ReasonDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.matching.ignoreLine(methodId, lineId, dto.reason, user.sub);
  }

  @Post('methods/:methodId/lines/:lineId/reopen')
  @HttpCode(200)
  @PermissionAction('match')
  reopenLine(
    @Param('methodId', ParseUUIDPipe) methodId: string,
    @Param('lineId', ParseUUIDPipe) lineId: string,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.matching.reopenLine(methodId, lineId, user.sub);
  }
}
