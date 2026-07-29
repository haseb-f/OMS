import { Body, Controller, Get, HttpCode, Param, Post } from '@nestjs/common';
import { SalesOrdersService } from './sales-orders.service';
import { CreateSalesOrderDto } from './dto/create-sales-order.dto';
import { AssignShippingEmployeeDto } from './dto/assign-shipping-employee.dto';
import { AssignShippingCompanyDto } from './dto/assign-shipping-company.dto';
import { AddTrackingNumberDto } from './dto/add-tracking-number.dto';
import { UploadShippingLabelDto } from './dto/upload-shipping-label.dto';
import { AddShippingCostDto } from './dto/add-shipping-cost.dto';
import { CreateSalesOrderNoteDto } from './dto/create-sales-order-note.dto';
import { CreateSalesOrderAttachmentDto } from './dto/create-sales-order-attachment.dto';

/**
 * Business operations, not generic CRUD (per TASK-011: "Never implement
 * generic CRUD first"). Creation only via "Create Order From Paid Lead" —
 * there is no generic POST accepting arbitrary fields. There is no generic
 * PATCH — every mutation is one of the named operations below. There is no
 * delete endpoint — not in the required operations list.
 */
@Controller('sales-orders')
export class SalesOrdersController {
  constructor(private readonly salesOrdersService: SalesOrdersService) {}

  @Post()
  create(@Body() dto: CreateSalesOrderDto) {
    return this.salesOrdersService.create(dto);
  }

  @Get()
  findAll() {
    return this.salesOrdersService.findAll();
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.salesOrdersService.findOne(id);
  }

  @Post(':id/ready-for-shipping')
  @HttpCode(200)
  readyForShipping(@Param('id') id: string) {
    return this.salesOrdersService.readyForShipping(id);
  }

  @Post(':id/shipping-employee')
  @HttpCode(200)
  assignShippingEmployee(
    @Param('id') id: string,
    @Body() dto: AssignShippingEmployeeDto,
  ) {
    return this.salesOrdersService.assignShippingEmployee(id, dto);
  }

  @Post(':id/shipping-company')
  @HttpCode(200)
  assignShippingCompany(
    @Param('id') id: string,
    @Body() dto: AssignShippingCompanyDto,
  ) {
    return this.salesOrdersService.assignShippingCompany(id, dto);
  }

  @Post(':id/tracking-number')
  @HttpCode(200)
  addTrackingNumber(
    @Param('id') id: string,
    @Body() dto: AddTrackingNumberDto,
  ) {
    return this.salesOrdersService.addTrackingNumber(id, dto);
  }

  @Post(':id/shipping-label')
  uploadShippingLabel(
    @Param('id') id: string,
    @Body() dto: UploadShippingLabelDto,
  ) {
    return this.salesOrdersService.uploadShippingLabel(id, dto);
  }

  @Post(':id/ship')
  @HttpCode(200)
  markShipped(@Param('id') id: string) {
    return this.salesOrdersService.markShipped(id);
  }

  @Post(':id/deliver')
  @HttpCode(200)
  markDelivered(@Param('id') id: string) {
    return this.salesOrdersService.markDelivered(id);
  }

  @Post(':id/return')
  @HttpCode(200)
  returnOrder(@Param('id') id: string) {
    return this.salesOrdersService.returnOrder(id);
  }

  @Post(':id/reship')
  createReshipment(@Param('id') id: string) {
    return this.salesOrdersService.createReshipment(id);
  }

  @Post(':id/shipping-cost')
  @HttpCode(200)
  addShippingCost(@Param('id') id: string, @Body() dto: AddShippingCostDto) {
    return this.salesOrdersService.addShippingCost(id, dto);
  }

  @Post(':id/notes')
  addNote(@Param('id') id: string, @Body() dto: CreateSalesOrderNoteDto) {
    return this.salesOrdersService.addNote(id, dto);
  }

  @Post(':id/attachments')
  uploadAttachment(
    @Param('id') id: string,
    @Body() dto: CreateSalesOrderAttachmentDto,
  ) {
    return this.salesOrdersService.uploadAttachment(id, dto);
  }
}
