import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import { ProductComponentsService } from './product-components.service';
import { CreateProductComponentDto } from '../dto/create-product-component.dto';
import { UpdateProductComponentDto } from '../dto/update-product-component.dto';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';

@Controller('products/:productId/components')
@UseGuards(JwtAuthGuard)
export class ProductComponentsController {
  constructor(
    private readonly productComponentsService: ProductComponentsService,
  ) {}

  @Get()
  findAll(@Param('productId') productId: string) {
    return this.productComponentsService.findAllForKit(productId);
  }

  @Post()
  create(
    @Param('productId') productId: string,
    @Body() dto: CreateProductComponentDto,
  ) {
    return this.productComponentsService.create(productId, dto);
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() dto: UpdateProductComponentDto) {
    return this.productComponentsService.update(id, dto);
  }

  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.productComponentsService.remove(id);
  }
}
