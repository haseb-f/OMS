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
import { ShippingCompaniesService } from './shipping-companies.service';
import { CreateShippingCompanyDto } from './dto/create-shipping-company.dto';
import { UpdateShippingCompanyDto } from './dto/update-shipping-company.dto';
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

/** Master Data — Shipping Companies. Business operations: Create, Update, Archive, Restore, Search. */
@Controller('shipping-companies')
@UseGuards(JwtAuthGuard, PermissionsGuard)
@PermissionModule('shipping-companies')
export class ShippingCompaniesController {
  constructor(
    private readonly shippingCompaniesService: ShippingCompaniesService,
  ) {}

  @Post()
  create(
    @Body() dto: CreateShippingCompanyDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.shippingCompaniesService.create(dto, user.sub);
  }

  @Get()
  @SkipPermissionCheck()
  findAll(@Query() query: MasterDataQueryDto) {
    return this.shippingCompaniesService.findAll(query);
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.shippingCompaniesService.findOne(id);
  }

  @Get(':id/activity')
  activity(@Param('id') id: string) {
    return this.shippingCompaniesService.activityFor(id);
  }

  @Patch(':id')
  update(
    @Param('id') id: string,
    @Body() dto: UpdateShippingCompanyDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.shippingCompaniesService.update(id, dto, user.sub);
  }

  @Post(':id/archive')
  @PermissionAction('delete')
  archive(@Param('id') id: string, @CurrentUser() user: JwtPayload) {
    return this.shippingCompaniesService.archive(id, user.sub);
  }

  @Post(':id/restore')
  restore(@Param('id') id: string, @CurrentUser() user: JwtPayload) {
    return this.shippingCompaniesService.restore(id, user.sub);
  }
}
