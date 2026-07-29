import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
} from '@nestjs/common';
import { PaymentSourcesService } from './payment-sources.service';
import { CreatePaymentSourceDto } from './dto/create-payment-source.dto';
import { UpdatePaymentSourceDto } from './dto/update-payment-source.dto';

/** Administrator can: Create, Edit, Deactivate, Archive. */
@Controller('payment-sources')
export class PaymentSourcesController {
  constructor(private readonly paymentSourcesService: PaymentSourcesService) {}

  @Post()
  create(@Body() dto: CreatePaymentSourceDto) {
    return this.paymentSourcesService.create(dto);
  }

  @Get()
  findAll() {
    return this.paymentSourcesService.findAll();
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.paymentSourcesService.findOne(id);
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() dto: UpdatePaymentSourceDto) {
    return this.paymentSourcesService.update(id, dto);
  }

  @Post(':id/deactivate')
  @HttpCode(200)
  deactivate(@Param('id') id: string) {
    return this.paymentSourcesService.deactivate(id);
  }

  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.paymentSourcesService.remove(id);
  }
}
