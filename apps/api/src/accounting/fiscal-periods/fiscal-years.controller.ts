import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
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
import { FiscalYearsService } from './fiscal-years.service';
import { CreateFiscalYearDto } from './dto/create-fiscal-year.dto';

/** Business operations only: Create (auto-generates monthly periods), Close, Reopen, Search, Details. */
@Controller('accounting/fiscal-years')
@UseGuards(JwtAuthGuard, PermissionsGuard)
@PermissionModule('fiscal-configuration')
export class FiscalYearsController {
  constructor(private readonly fiscalYears: FiscalYearsService) {}

  @Post()
  @PermissionAction('manage')
  create(@Body() dto: CreateFiscalYearDto, @CurrentUser() user: JwtPayload) {
    return this.fiscalYears.create(dto, user.sub);
  }

  @Get()
  @SkipPermissionCheck()
  findAll() {
    return this.fiscalYears.findAll();
  }

  @Get(':id')
  @SkipPermissionCheck()
  findOne(@Param('id') id: string) {
    return this.fiscalYears.findOne(id);
  }

  @Post(':id/close')
  @HttpCode(200)
  @PermissionAction('manage')
  close(@Param('id') id: string, @CurrentUser() user: JwtPayload) {
    return this.fiscalYears.close(id, user.sub);
  }

  @Post(':id/reopen')
  @HttpCode(200)
  @PermissionAction('manage')
  reopen(@Param('id') id: string, @CurrentUser() user: JwtPayload) {
    return this.fiscalYears.reopen(id, user.sub);
  }

  @Post(':id/archive')
  @HttpCode(200)
  @PermissionAction('manage')
  archive(@Param('id') id: string, @CurrentUser() user: JwtPayload) {
    return this.fiscalYears.archive(id, user.sub);
  }

  @Post(':id/set-default')
  @HttpCode(200)
  @PermissionAction('manage')
  setDefault(@Param('id') id: string, @CurrentUser() user: JwtPayload) {
    return this.fiscalYears.setDefault(id, user.sub);
  }
}
