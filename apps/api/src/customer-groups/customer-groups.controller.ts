import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { CustomerGroupsService } from './customer-groups.service';
import { CreateCustomerGroupDto } from './dto/create-customer-group.dto';
import { UpdateCustomerGroupDto } from './dto/update-customer-group.dto';
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

/** Master Data — Customer Groups. Business operations: Create, Update, Archive, Restore, Search. */
@Controller('customer-groups')
@UseGuards(JwtAuthGuard, PermissionsGuard)
@PermissionModule('customer-groups')
export class CustomerGroupsController {
  constructor(private readonly customerGroupsService: CustomerGroupsService) {}

  @Post()
  create(@Body() dto: CreateCustomerGroupDto, @CurrentUser() user: JwtPayload) {
    return this.customerGroupsService.create(dto, user.sub);
  }

  @Get()
  @SkipPermissionCheck()
  findAll(@Query() query: MasterDataQueryDto) {
    return this.customerGroupsService.findAll(query);
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.customerGroupsService.findOne(id);
  }

  @Get(':id/activity')
  activity(@Param('id') id: string) {
    return this.customerGroupsService.activityFor(id);
  }

  @Patch(':id')
  update(
    @Param('id') id: string,
    @Body() dto: UpdateCustomerGroupDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.customerGroupsService.update(id, dto, user.sub);
  }

  @Post(':id/archive')
  @PermissionAction('delete')
  archive(@Param('id') id: string, @CurrentUser() user: JwtPayload) {
    return this.customerGroupsService.archive(id, user.sub);
  }

  @Post(':id/restore')
  restore(@Param('id') id: string, @CurrentUser() user: JwtPayload) {
    return this.customerGroupsService.restore(id, user.sub);
  }
}
