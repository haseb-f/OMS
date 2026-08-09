import { Controller, Get, Param, UseGuards } from '@nestjs/common';
import { ProductAttachmentsService } from './product-attachments.service';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';

/** GET only here — creation goes through ProductsController's own "attach" operation. */
@Controller('products/:productId/attachments')
@UseGuards(JwtAuthGuard)
export class ProductAttachmentsController {
  constructor(
    private readonly productAttachmentsService: ProductAttachmentsService,
  ) {}

  @Get()
  findAll(@Param('productId') productId: string) {
    return this.productAttachmentsService.findAllForProduct(productId);
  }
}
