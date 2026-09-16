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
import { PaymentSourcesService } from './payment-sources.service';
import { CreatePaymentSourceDto } from './dto/create-payment-source.dto';
import { UpdatePaymentSourceDto } from './dto/update-payment-source.dto';
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

/** Administrator can: Create, Edit, Deactivate, Archive. */
@Controller('payment-sources')
@UseGuards(JwtAuthGuard, PermissionsGuard)
@PermissionModule('payment-sources')
export class PaymentSourcesController {
  constructor(private readonly paymentSourcesService: PaymentSourcesService) {}

  @Post()
  create(@Body() dto: CreatePaymentSourceDto, @CurrentUser() user: JwtPayload) {
    return this.paymentSourcesService.create(dto, user.sub);
  }

  @Get()
  @SkipPermissionCheck()
  findAll(@Query() query: MasterDataQueryDto) {
    return this.paymentSourcesService.findAll(query);
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.paymentSourcesService.findOne(id);
  }

  @Get(':id/activity')
  activity(@Param('id') id: string) {
    return this.paymentSourcesService.activityFor(id);
  }

  @Patch(':id')
  update(
    @Param('id') id: string,
    @Body() dto: UpdatePaymentSourceDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.paymentSourcesService.update(id, dto, user.sub);
  }

  @Post(':id/deactivate')
  @PermissionAction('edit')
  deactivate(@Param('id') id: string, @CurrentUser() user: JwtPayload) {
    return this.paymentSourcesService.deactivate(id, user.sub);
  }

  @Post(':id/archive')
  @PermissionAction('delete')
  archive(@Param('id') id: string, @CurrentUser() user: JwtPayload) {
    return this.paymentSourcesService.archive(id, user.sub);
  }

  @Post(':id/restore')
  restore(@Param('id') id: string, @CurrentUser() user: JwtPayload) {
    return this.paymentSourcesService.restore(id, user.sub);
  }
}
