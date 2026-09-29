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
import { PermissionsGuard } from '../../auth/guards/permissions.guard';
import { PermissionModule } from '../../auth/decorators/permission-module.decorator';
import {
  PermissionAction,
  SkipPermissionCheck,
} from '../../auth/decorators/permission-action.decorator';
import { CurrentUser } from '../../auth/decorators/current-user.decorator';
import type { JwtPayload } from '../../auth/guards/jwt-auth.guard';
import { YearClosingService } from './year-closing.service';
import { CloseYearDto, ReverseYearClosingDto } from './dto/close-year.dto';

@Controller('accounting/year-closing')
@UseGuards(JwtAuthGuard, PermissionsGuard)
@PermissionModule('fiscal-configuration')
export class YearClosingController {
  constructor(private readonly yearClosing: YearClosingService) {}

  /** Idempotent: a repeated request returns the existing closing (`alreadyClosed: true`). */
  @Post()
  @HttpCode(200)
  @PermissionAction('manage')
  execute(@Body() dto: CloseYearDto, @CurrentUser() user: JwtPayload) {
    return this.yearClosing.execute(dto, user.sub);
  }

  /** GETs stay open to any authenticated Finance user (fiscal-configuration has no `view`). */
  @Get(':fiscalYearId')
  @SkipPermissionCheck()
  status(@Param('fiscalYearId', ParseUUIDPipe) fiscalYearId: string) {
    return this.yearClosing.status(fiscalYearId);
  }

  @Post(':fiscalYearId/reverse')
  @HttpCode(200)
  @PermissionAction('manage')
  reverse(
    @Param('fiscalYearId', ParseUUIDPipe) fiscalYearId: string,
    @Body() dto: ReverseYearClosingDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.yearClosing.reverse(fiscalYearId, dto, user.sub);
  }
}
