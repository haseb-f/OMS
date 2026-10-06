import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ReceivingAccountsService } from './receiving-accounts.service';
import { CreateReceivingAccountDto } from './dto/create-receiving-account.dto';
import { UpdateReceivingAccountDto } from './dto/update-receiving-account.dto';
import { MasterDataQueryDto } from '../master-data/dto/master-data-query.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { PermissionsGuard } from '../auth/guards/permissions.guard';
import { PermissionModule } from '../auth/decorators/permission-module.decorator';
import {
  PermissionAction,
  SkipPermissionCheck,
} from '../auth/decorators/permission-action.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { JwtPayload } from '../auth/guards/jwt-auth.guard';

/** Administrator can: Create, Edit, Archive, Restore. */
@Controller('receiving-accounts')
@UseGuards(JwtAuthGuard, PermissionsGuard)
@PermissionModule('receiving-accounts')
export class ReceivingAccountsController {
  constructor(
    private readonly receivingAccountsService: ReceivingAccountsService,
  ) {}

  @Post()
  create(
    @Body() dto: CreateReceivingAccountDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.receivingAccountsService.create(dto, user.sub);
  }

  @Get()
  @SkipPermissionCheck()
  findAll(@Query() query: MasterDataQueryDto) {
    return this.receivingAccountsService.findAll(query);
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.receivingAccountsService.findOne(id);
  }

  @Get(':id/activity')
  activity(@Param('id') id: string) {
    return this.receivingAccountsService.activityFor(id);
  }

  @Patch(':id')
  update(
    @Param('id') id: string,
    @Body() dto: UpdateReceivingAccountDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.receivingAccountsService.update(id, dto, user.sub);
  }

  @Post(':id/archive')
  @PermissionAction('delete')
  archive(@Param('id') id: string, @CurrentUser() user: JwtPayload) {
    return this.receivingAccountsService.archive(id, user.sub);
  }

  /** Legacy archive verb — same soft delete as `POST :id/archive`. */
  @Delete(':id')
  @PermissionAction('delete')
  remove(@Param('id') id: string, @CurrentUser() user: JwtPayload) {
    return this.receivingAccountsService.archive(id, user.sub);
  }

  @Post(':id/restore')
  restore(@Param('id') id: string, @CurrentUser() user: JwtPayload) {
    return this.receivingAccountsService.restore(id, user.sub);
  }
}
