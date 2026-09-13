import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { CapitalReturnsService } from './capital-returns.service';
import { CreateCapitalReturnDto } from './dto/create-capital-return.dto';
import { FindCapitalReturnsQueryDto } from './dto/find-capital-returns-query.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { PermissionsGuard } from '../auth/guards/permissions.guard';
import { PermissionModule } from '../auth/decorators/permission-module.decorator';
import { PermissionAction } from '../auth/decorators/permission-action.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { JwtPayload } from '../auth/guards/jwt-auth.guard';

/** Investor Engine Milestone 3, Phases 31-35 — Capital Return foundation (Draft/Approve/Pay), manual and controlled only. */
@Controller('capital-returns')
@UseGuards(JwtAuthGuard, PermissionsGuard)
@PermissionModule('capital-returns')
export class CapitalReturnsController {
  constructor(private readonly returnsService: CapitalReturnsService) {}

  @Get()
  findAll(@Query() query: FindCapitalReturnsQueryDto) {
    return this.returnsService.findAll(query);
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.returnsService.findOne(id);
  }

  @Get(':id/activity')
  activity(@Param('id') id: string) {
    return this.returnsService.activityFor(id);
  }

  @Post()
  @HttpCode(201)
  create(@Body() dto: CreateCapitalReturnDto, @CurrentUser() user: JwtPayload) {
    return this.returnsService.create(dto, user.sub);
  }

  @Post(':id/approve')
  @HttpCode(200)
  @PermissionAction('approve')
  approve(@Param('id') id: string, @CurrentUser() user: JwtPayload) {
    return this.returnsService.approve(id, user.sub);
  }

  @Post(':id/pay')
  @HttpCode(200)
  @PermissionAction('confirm')
  pay(@Param('id') id: string, @CurrentUser() user: JwtPayload) {
    return this.returnsService.pay(id, user.sub);
  }

  @Post(':id/cancel')
  @HttpCode(200)
  @PermissionAction('cancel')
  cancel(@Param('id') id: string, @CurrentUser() user: JwtPayload) {
    return this.returnsService.cancel(id, user.sub);
  }
}
