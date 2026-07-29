import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
} from '@nestjs/common';
import { ProductBrandsService } from './product-brands.service';
import { CreateProductBrandDto } from './dto/create-product-brand.dto';
import { UpdateProductBrandDto } from './dto/update-product-brand.dto';

@Controller('product-brands')
export class ProductBrandsController {
  constructor(private readonly productBrandsService: ProductBrandsService) {}

  @Post()
  create(@Body() dto: CreateProductBrandDto) {
    return this.productBrandsService.create(dto);
  }

  @Get()
  findAll() {
    return this.productBrandsService.findAll();
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.productBrandsService.findOne(id);
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() dto: UpdateProductBrandDto) {
    return this.productBrandsService.update(id, dto);
  }

  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.productBrandsService.remove(id);
  }
}
