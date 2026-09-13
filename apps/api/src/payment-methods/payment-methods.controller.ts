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
import { PaymentMethodsService } from './payment-methods.service';
import { CreatePaymentMethodDto } from './dto/create-payment-method.dto';
import { UpdatePaymentMethodDto } from './dto/update-payment-method.dto';
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

/** Master Data — Payment Methods. Business operations: Create, Update, Archive, Restore, Search. */
@Controller('payment-methods')
@UseGuards(JwtAuthGuard, PermissionsGuard)
@PermissionModule('payment-methods')
export class PaymentMethodsController {
  constructor(private readonly paymentMethodsService: PaymentMethodsService) {}

  @Post()
  create(@Body() dto: CreatePaymentMethodDto, @CurrentUser() user: JwtPayload) {
    return this.paymentMethodsService.create(dto, user.sub);
  }

  @Get()
  @SkipPermissionCheck()
  findAll(@Query() query: MasterDataQueryDto) {
    return this.paymentMethodsService.findAll(query);
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.paymentMethodsService.findOne(id);
  }

  @Get(':id/activity')
  activity(@Param('id') id: string) {
    return this.paymentMethodsService.activityFor(id);
  }

  @Patch(':id')
  update(
    @Param('id') id: string,
    @Body() dto: UpdatePaymentMethodDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.paymentMethodsService.update(id, dto, user.sub);
  }

  @Post(':id/archive')
  @PermissionAction('delete')
  archive(@Param('id') id: string, @CurrentUser() user: JwtPayload) {
    return this.paymentMethodsService.archive(id, user.sub);
  }

  @Post(':id/restore')
  restore(@Param('id') id: string, @CurrentUser() user: JwtPayload) {
    return this.paymentMethodsService.restore(id, user.sub);
  }
}
