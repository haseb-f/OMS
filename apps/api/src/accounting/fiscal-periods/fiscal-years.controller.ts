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
import { CurrentUser } from '../../auth/decorators/current-user.decorator';
import type { JwtPayload } from '../../auth/guards/jwt-auth.guard';
import { FiscalYearsService } from './fiscal-years.service';
import { CreateFiscalYearDto } from './dto/create-fiscal-year.dto';

/** Business operations only: Create (auto-generates monthly periods), Close, Reopen, Search, Details. */
@Controller('accounting/fiscal-years')
@UseGuards(JwtAuthGuard)
export class FiscalYearsController {
  constructor(private readonly fiscalYears: FiscalYearsService) {}

  @Post()
  create(@Body() dto: CreateFiscalYearDto, @CurrentUser() user: JwtPayload) {
    return this.fiscalYears.create(dto, user.sub);
  }

  @Get()
  findAll() {
    return this.fiscalYears.findAll();
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.fiscalYears.findOne(id);
  }

  @Post(':id/close')
  @HttpCode(200)
  close(@Param('id') id: string, @CurrentUser() user: JwtPayload) {
    return this.fiscalYears.close(id, user.sub);
  }

  @Post(':id/reopen')
  @HttpCode(200)
  reopen(@Param('id') id: string, @CurrentUser() user: JwtPayload) {
    return this.fiscalYears.reopen(id, user.sub);
  }

  @Post(':id/archive')
  @HttpCode(200)
  archive(@Param('id') id: string, @CurrentUser() user: JwtPayload) {
    return this.fiscalYears.archive(id, user.sub);
  }

  @Post(':id/set-default')
  @HttpCode(200)
  setDefault(@Param('id') id: string, @CurrentUser() user: JwtPayload) {
    return this.fiscalYears.setDefault(id, user.sub);
  }
}
