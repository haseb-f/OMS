import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateProductAttachmentDto } from '../dto/create-product-attachment.dto';

@Injectable()
export class ProductAttachmentsService {
  constructor(private readonly prisma: PrismaService) {}

  create(
    productId: string,
    uploadedById: string,
    dto: CreateProductAttachmentDto,
    tx: Prisma.TransactionClient | PrismaService = this.prisma,
  ) {
    return tx.productAttachment.create({
      data: { productId, uploadedById, ...dto },
    });
  }

  findAllForProduct(productId: string) {
    return this.prisma.productAttachment.findMany({
      where: { productId, deletedAt: null },
      orderBy: { createdAt: 'asc' },
    });
  }
}
