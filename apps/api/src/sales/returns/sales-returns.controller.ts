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
import { SalesReturnsService } from './sales-returns.service';
import { CreateSalesReturnDto } from './dto/create-sales-return.dto';
import { UpdateSalesReturnDto } from './dto/update-sales-return.dto';
import { FindSalesReturnsQueryDto } from './dto/find-sales-returns-query.dto';

/** Business operations only: Create, Update, Submit, Approve, Confirm (Increase Inventory), Cancel, Archive, Search, Details. */
@Controller('sales/returns')
@UseGuards(JwtAuthGuard, PermissionsGuard)
@PermissionModule('sales-returns')
export class SalesReturnsController {
  constructor(private readonly returnsService: SalesReturnsService) {}

  @Post()
  create(@Body() dto: CreateSalesReturnDto) {
    return this.returnsService.create(dto);
  }

  @Get()
  findAll(@Query() query: FindSalesReturnsQueryDto) {
    return this.returnsService.findAll(query);
  }

  @Get('returnable-summary/:salesInvoiceId')
  returnableSummary(@Param('salesInvoiceId') salesInvoiceId: string) {
    return this.returnsService.returnableSummary(salesInvoiceId);
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.returnsService.findOne(id);
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() dto: UpdateSalesReturnDto) {
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

  @Post(':id/confirm')
  @HttpCode(200)
  @PermissionAction('confirm')
  confirm(@Param('id') id: string, @CurrentUser() user: JwtPayload) {
    return this.returnsService.confirm(id, user.sub);
  }

  @Post(':id/cancel')
  @HttpCode(200)
  @PermissionAction('cancel')
  cancel(@Param('id') id: string, @CurrentUser() user: JwtPayload) {
    return this.returnsService.cancel(id, user.sub);
  }

  @Post(':id/archive')
  @HttpCode(200)
  @PermissionAction('delete')
  archive(@Param('id') id: string, @CurrentUser() user: JwtPayload) {
    return this.returnsService.archive(id, user.sub);
  }
}
