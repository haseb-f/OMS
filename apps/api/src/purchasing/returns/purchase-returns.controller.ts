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
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { PermissionsGuard } from '../../auth/guards/permissions.guard';
import { PermissionModule } from '../../auth/decorators/permission-module.decorator';
import {
  PermissionAction,
  SkipPermissionCheck,
} from '../../auth/decorators/permission-action.decorator';
import { CurrentUser } from '../../auth/decorators/current-user.decorator';
import type { JwtPayload } from '../../auth/guards/jwt-auth.guard';
import { PurchaseReturnsService } from './purchase-returns.service';
import { CreatePurchaseReturnDto } from './dto/create-purchase-return.dto';
import { UpdatePurchaseReturnDto } from './dto/update-purchase-return.dto';
import { FindPurchaseReturnsQueryDto } from './dto/find-purchase-returns-query.dto';

/** Business operations only: Create, Update, Submit, Approve, Cancel, Confirm, Archive, Search, Details. */
@Controller('purchasing/returns')
@UseGuards(JwtAuthGuard, PermissionsGuard)
@PermissionModule('purchase-returns')
export class PurchaseReturnsController {
  constructor(private readonly returnsService: PurchaseReturnsService) {}

  @Post()
  create(@Body() dto: CreatePurchaseReturnDto) {
    return this.returnsService.create(dto);
  }

  @Get()
  findAll(@Query() query: FindPurchaseReturnsQueryDto) {
    return this.returnsService.findAll(query);
  }

  @Get('returnable-summary/:purchaseInvoiceId')
  returnableSummary(@Param('purchaseInvoiceId') purchaseInvoiceId: string) {
    return this.returnsService.returnableSummary(purchaseInvoiceId);
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.returnsService.findOne(id);
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() dto: UpdatePurchaseReturnDto) {
    return this.returnsService.update(id, dto);
  }

  @Post(':id/submit')
  @HttpCode(200)
  @SkipPermissionCheck()
  submit(@Param('id') id: string) {
    return this.returnsService.submit(id);
  }

  @Post(':id/approve')
  @HttpCode(200)
  @PermissionAction('approve')
  approve(@Param('id') id: string) {
    return this.returnsService.approve(id);
  }

  @Post(':id/cancel')
  @HttpCode(200)
  @PermissionAction('cancel')
  cancel(@Param('id') id: string, @CurrentUser() user: JwtPayload) {
    return this.returnsService.cancel(id, user.sub);
  }

  @Post(':id/confirm')
  @HttpCode(200)
  @PermissionAction('confirm')
  confirm(@Param('id') id: string, @CurrentUser() user: JwtPayload) {
    return this.returnsService.confirm(id, user.sub);
  }

  @Post(':id/archive')
  @HttpCode(200)
  @PermissionAction('delete')
  archive(@Param('id') id: string, @CurrentUser() user: JwtPayload) {
    return this.returnsService.archive(id, user.sub);
  }
}
