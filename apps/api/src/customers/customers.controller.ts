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
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { PermissionsGuard } from '../auth/guards/permissions.guard';
import { PermissionModule } from '../auth/decorators/permission-module.decorator';
import {
  PermissionAction,
  SkipPermissionCheck,
} from '../auth/decorators/permission-action.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { JwtPayload } from '../auth/guards/jwt-auth.guard';
import { CustomersService } from './customers.service';
import { CreateCustomerDto } from './dto/create-customer.dto';
import { UpdateCustomerDto } from './dto/update-customer.dto';
import { FindOrCreateCustomerDto } from './dto/find-or-create-customer.dto';
import { FindCustomersQueryDto } from './dto/find-customers-query.dto';
import { BulkIdsDto } from '../master-data/dto/bulk-ids.dto';

/** Business operations: Create, Update, Archive, Restore, Search, Find-or-Create. */
@Controller('customers')
@UseGuards(JwtAuthGuard, PermissionsGuard)
@PermissionModule('customers')
export class CustomersController {
  constructor(private readonly customersService: CustomersService) {}

  @Post()
  create(@Body() dto: CreateCustomerDto, @CurrentUser() user: JwtPayload) {
    return this.customersService.create(dto, user.sub);
  }

  @Post('find-or-create')
  findOrCreate(
    @Body() dto: FindOrCreateCustomerDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.customersService.findOrCreate(dto, user.sub);
  }

  /**
   * Read-only "does this phone number already belong to a Customer?" check
   * (TASK-061) — the Leads/Orders form and Import Center preview use this to
   * show "Existing Customer Found" before anything is created. Never writes.
   */
  @Get('lookup')
  lookupByPhone(@Query('phone') phone: string) {
    return this.customersService.lookupByPhone(phone);
  }

  /** "Select all matching filters" (Part 8) — bare IDs only, same filter/search as `findAll`. */
  @Get('ids')
  findAllIds(@Query() query: FindCustomersQueryDto) {
    return this.customersService.findAllIds(query);
  }

  @Get()
  findAll(@Query() query: FindCustomersQueryDto) {
    return this.customersService.findAll(query);
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.customersService.findOne(id);
  }

  @Get(':id/activity')
  activity(@Param('id') id: string) {
    return this.customersService.activityFor(id);
  }

  @Patch(':id')
  update(
    @Param('id') id: string,
    @Body() dto: UpdateCustomerDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.customersService.update(id, dto, user.sub);
  }

  @Post(':id/archive')
  @PermissionAction('delete')
  archive(@Param('id') id: string, @CurrentUser() user: JwtPayload) {
    return this.customersService.archive(id, user.sub);
  }

  @Post('bulk-archive')
  @PermissionAction('delete')
  bulkArchive(@Body() dto: BulkIdsDto, @CurrentUser() user: JwtPayload) {
    return this.customersService.archiveMany(dto.ids, user.sub);
  }

  @Post(':id/restore')
  @SkipPermissionCheck()
  restore(@Param('id') id: string, @CurrentUser() user: JwtPayload) {
    return this.customersService.restore(id, user.sub);
  }
}
