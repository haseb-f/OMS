import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
} from '@nestjs/common';
import { ShippingCompaniesService } from './shipping-companies.service';
import { CreateShippingCompanyDto } from './dto/create-shipping-company.dto';
import { UpdateShippingCompanyDto } from './dto/update-shipping-company.dto';

@Controller('shipping-companies')
export class ShippingCompaniesController {
  constructor(
    private readonly shippingCompaniesService: ShippingCompaniesService,
  ) {}

  @Post()
  create(@Body() dto: CreateShippingCompanyDto) {
    return this.shippingCompaniesService.create(dto);
  }

  @Get()
  findAll() {
    return this.shippingCompaniesService.findAll();
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.shippingCompaniesService.findOne(id);
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() dto: UpdateShippingCompanyDto) {
    return this.shippingCompaniesService.update(id, dto);
  }

  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.shippingCompaniesService.remove(id);
  }
}
