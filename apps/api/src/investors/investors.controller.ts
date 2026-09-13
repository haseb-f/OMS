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
} from '@nestjs/common';
import { InvestorsService } from './investors.service';
import { CreateInvestorDto } from './dto/create-investor.dto';
import { UpdateInvestorDto } from './dto/update-investor.dto';
import { InvestorsQueryDto } from './dto/investors-query.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { PermissionsGuard } from '../auth/guards/permissions.guard';
import { PermissionModule } from '../auth/decorators/permission-module.decorator';
import { PermissionAction } from '../auth/decorators/permission-action.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { JwtPayload } from '../auth/guards/jwt-auth.guard';

/** Investor Engine Milestone 1, Phase 2/4/21/22 — Investor (investment/business entity), distinct from User. */
@Controller('investors')
@UseGuards(JwtAuthGuard, PermissionsGuard)
@PermissionModule('investors')
export class InvestorsController {
  constructor(private readonly investorsService: InvestorsService) {}

  @Post()
  create(@Body() dto: CreateInvestorDto, @CurrentUser() user: JwtPayload) {
    return this.investorsService.create(dto, user.sub);
  }

  @Get()
  findAll(@Query() query: InvestorsQueryDto) {
    return this.investorsService.findAll(query);
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.investorsService.findOne(id);
  }

  @Get(':id/activity')
  activity(@Param('id') id: string) {
    return this.investorsService.activityFor(id);
  }

  @Patch(':id')
  update(
    @Param('id') id: string,
    @Body() dto: UpdateInvestorDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.investorsService.update(id, dto, user.sub);
  }

  @Post(':id/archive')
  @HttpCode(200)
  @PermissionAction('delete')
  archive(@Param('id') id: string, @CurrentUser() user: JwtPayload) {
    return this.investorsService.archive(id, user.sub);
  }

  @Post(':id/restore')
  @HttpCode(200)
  @PermissionAction('delete')
  restore(@Param('id') id: string, @CurrentUser() user: JwtPayload) {
    return this.investorsService.restore(id, user.sub);
  }
}
