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
import { ProductVariantsService } from './product-variants.service';
import { CreateProductVariantDto } from '../dto/create-product-variant.dto';
import { UpdateProductVariantDto } from '../dto/update-product-variant.dto';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../../auth/decorators/current-user.decorator';
import type { JwtPayload } from '../../auth/guards/jwt-auth.guard';

@Controller('products/:productId/variants')
@UseGuards(JwtAuthGuard)
export class ProductVariantsController {
  constructor(
    private readonly productVariantsService: ProductVariantsService,
  ) {}

  @Get()
  findAll(@Param('productId') productId: string) {
    return this.productVariantsService.findAllForProduct(productId);
  }

  @Post()
  create(
    @Param('productId') productId: string,
    @Body() dto: CreateProductVariantDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.productVariantsService.create(productId, dto, user.sub);
  }

  @Patch(':id')
  update(
    @Param('id') id: string,
    @Body() dto: UpdateProductVariantDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.productVariantsService.update(id, dto, user.sub);
  }

  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.productVariantsService.remove(id);
  }
}
