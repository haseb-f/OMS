import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { PurchaseOrdersService } from './purchase-orders.service';
import { CreatePurchaseOrderDto } from './dto/create-purchase-order.dto';
import { FindPurchaseOrdersQueryDto } from './dto/find-purchase-orders-query.dto';

/** Business operations only: Create, Approve, Cancel, Close, Search, Details, Timeline. */
@Controller('purchase-orders')
export class PurchaseOrdersController {
  constructor(private readonly purchaseOrdersService: PurchaseOrdersService) {}

  @Post()
  create(@Body() dto: CreatePurchaseOrderDto) {
    return this.purchaseOrdersService.create(dto);
  }

  @Get()
  findAll(@Query() query: FindPurchaseOrdersQueryDto) {
    return this.purchaseOrdersService.findAll(query);
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.purchaseOrdersService.findOne(id);
  }

  @Post(':id/approve')
  approve(@Param('id') id: string) {
    return this.purchaseOrdersService.approve(id);
  }

  @Post(':id/cancel')
  cancel(@Param('id') id: string) {
    return this.purchaseOrdersService.cancel(id);
  }

  @Post(':id/close')
  close(@Param('id') id: string) {
    return this.purchaseOrdersService.close(id);
  }
}
