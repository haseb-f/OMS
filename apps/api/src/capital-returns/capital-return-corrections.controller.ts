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
import { PermissionsGuard } from '../auth/guards/permissions.guard';
import { PermissionModule } from '../auth/decorators/permission-module.decorator';
import { PermissionAction } from '../auth/decorators/permission-action.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { JwtPayload } from '../auth/guards/jwt-auth.guard';
import { CapitalReturnCorrectionService } from './capital-return-correction.service';
import { CapitalReturnCorrectionDto } from './dto/capital-return-correction.dto';

/**
 * Audited correction of Capital Return postings charged to profit or loss
 * (reverse + re-post against Investor Funding, `dryRun` previews). Gated
 * by the Investor accounting-mapping permission — it changes how a posted
 * document sits in the books, like changing that mapping does.
 */
@Controller('capital-returns/corrections')
@UseGuards(JwtAuthGuard, PermissionsGuard)
@PermissionModule('investment-accounting')
export class CapitalReturnCorrectionsController {
  constructor(private readonly corrections: CapitalReturnCorrectionService) {}

  @Get('affected')
  @PermissionAction('view')
  affected() {
    return this.corrections.listAffected();
  }

  @Post(':journalEntryId')
  @HttpCode(200)
  @PermissionAction('manage')
  correct(
    @Param('journalEntryId', ParseUUIDPipe) journalEntryId: string,
    @Body() dto: CapitalReturnCorrectionDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.corrections.correct(journalEntryId, dto, user.sub);
  }
}
