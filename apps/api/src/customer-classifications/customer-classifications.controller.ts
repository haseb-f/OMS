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
import { CustomerClassificationsService } from './customer-classifications.service';
import { CreateCustomerClassificationDto } from './dto/create-customer-classification.dto';
import { UpdateCustomerClassificationDto } from './dto/update-customer-classification.dto';
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

@Controller('customer-classifications')
@UseGuards(JwtAuthGuard, PermissionsGuard)
@PermissionModule('customer-classifications')
export class CustomerClassificationsController {
  constructor(
    private readonly customerClassificationsService: CustomerClassificationsService,
  ) {}

  @Post()
  create(
    @Body() dto: CreateCustomerClassificationDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.customerClassificationsService.create(dto, user.sub);
  }

  @Get()
  @SkipPermissionCheck()
  findAll(@Query() query: MasterDataQueryDto) {
    return this.customerClassificationsService.findAll(query);
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.customerClassificationsService.findOne(id);
  }

  @Get(':id/activity')
  activity(@Param('id') id: string) {
    return this.customerClassificationsService.activityFor(id);
  }

  @Patch(':id')
  update(
    @Param('id') id: string,
    @Body() dto: UpdateCustomerClassificationDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.customerClassificationsService.update(id, dto, user.sub);
  }

  @Post(':id/archive')
  @PermissionAction('delete')
  archive(@Param('id') id: string, @CurrentUser() user: JwtPayload) {
    return this.customerClassificationsService.archive(id, user.sub);
  }

  @Post(':id/restore')
  restore(@Param('id') id: string, @CurrentUser() user: JwtPayload) {
    return this.customerClassificationsService.restore(id, user.sub);
  }
}
