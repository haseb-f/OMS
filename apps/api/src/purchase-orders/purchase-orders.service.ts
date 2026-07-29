import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  Prisma,
  ProductStatus,
  PurchaseOrderStatus,
  SupplierStatus,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { SuppliersService } from '../suppliers/suppliers.service';
import { ProductsService } from '../products/products.service';
import {
  PurchaseOrderActivityService,
  PurchaseOrderActivityType,
} from './activities/purchase-order-activity.service';
import { CreatePurchaseOrderDto } from './dto/create-purchase-order.dto';
import { FindPurchaseOrdersQueryDto } from './dto/find-purchase-orders-query.dto';

@Injectable()
export class PurchaseOrdersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly suppliersService: SuppliersService,
    private readonly productsService: ProductsService,
    private readonly activityService: PurchaseOrderActivityService,
  ) {}

  /**
   * "Purchase Order is only an agreement to buy." This creates the order and
   * its lines only — no inventory movement, cost update, or accounting entry
   * happens here or in any status transition below.
   */
  async create(dto: CreatePurchaseOrderDto) {
    await this.assertActiveSupplier(dto.supplierId);
    for (const item of dto.items) {
      await this.assertActiveProduct(item.productId);
    }

    try {
      return await this.prisma.$transaction(async (tx) => {
        const poNumber = await this.generatePoNumber(tx);
        const po = await tx.purchaseOrder.create({
          data: {
            poNumber,
            supplierId: dto.supplierId,
            projectId: dto.projectId,
            costCenterId: dto.costCenterId,
            currencyId: dto.currencyId,
            purchaseType: dto.purchaseType,
            expectedDeliveryDate: dto.expectedDeliveryDate
              ? new Date(dto.expectedDeliveryDate)
              : undefined,
            referenceNumber: dto.referenceNumber,
            internalNotes: dto.internalNotes,
            supplierNotes: dto.supplierNotes,
            items: {
              create: dto.items.map((item) => ({
                productId: item.productId,
                description: item.description,
                quantity: item.quantity,
                unitId: item.unitId,
                unitPrice: item.unitPrice,
                discountValue: item.discountValue ?? 0,
                discountPercent: item.discountPercent ?? 0,
                subtotal: item.subtotal,
                notes: item.notes,
              })),
            },
          },
          include: { items: true },
        });

        await this.activityService.log(
          po.id,
          PurchaseOrderActivityType.PO_CREATED,
          `Purchase Order ${po.poNumber} created`,
          undefined,
          tx,
        );

        return po;
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError) {
        if (error.code === 'P2002') {
          throw new BadRequestException('PO Number must be unique.');
        }
        if (error.code === 'P2003') {
          throw new BadRequestException(
            'Invalid supplier, project, cost center, currency, product, or unit reference.',
          );
        }
      }
      throw error;
    }
  }

  /** "Search" — filters by Supplier/Status/Purchase Type; matches PO/Reference Number. */
  findAll(query: FindPurchaseOrdersQueryDto) {
    const where: Prisma.PurchaseOrderWhereInput = {
      deletedAt: null,
      supplierId: query.supplierId,
      status: query.status,
      purchaseType: query.purchaseType,
    };

    if (query.search) {
      where.OR = [
        { poNumber: { contains: query.search, mode: 'insensitive' } },
        { referenceNumber: { contains: query.search, mode: 'insensitive' } },
      ];
    }

    return this.prisma.purchaseOrder.findMany({
      where,
      include: { items: true },
    });
  }

  /** "Details." */
  async findOne(id: string) {
    const po = await this.prisma.purchaseOrder.findFirst({
      where: { id, deletedAt: null },
      include: { items: true },
    });
    if (!po) {
      throw new NotFoundException(`Purchase Order ${id} not found`);
    }
    return po;
  }

  approve(id: string) {
    return this.transition(
      id,
      [PurchaseOrderStatus.DRAFT],
      PurchaseOrderStatus.APPROVED,
      PurchaseOrderActivityType.PO_APPROVED,
      'approved',
    );
  }

  cancel(id: string) {
    return this.transition(
      id,
      [PurchaseOrderStatus.DRAFT, PurchaseOrderStatus.APPROVED],
      PurchaseOrderStatus.CANCELLED,
      PurchaseOrderActivityType.PO_CANCELLED,
      'cancelled',
    );
  }

  close(id: string) {
    return this.transition(
      id,
      [PurchaseOrderStatus.APPROVED],
      PurchaseOrderStatus.CLOSED,
      PurchaseOrderActivityType.PO_CLOSED,
      'closed',
    );
  }

  /** Status management only — never touches inventory, cost, or accounting. */
  private async transition(
    id: string,
    allowedFrom: PurchaseOrderStatus[],
    to: PurchaseOrderStatus,
    activityType: string,
    verb: string,
  ) {
    const po = await this.findOne(id);
    if (!allowedFrom.includes(po.status)) {
      throw new BadRequestException(
        `Cannot transition Purchase Order ${po.poNumber} from ${po.status} to ${to}.`,
      );
    }

    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.purchaseOrder.update({
        where: { id },
        data: { status: to },
      });
      await this.activityService.log(
        id,
        activityType,
        `Purchase Order ${po.poNumber} ${verb}`,
        undefined,
        tx,
      );
      return updated;
    });
  }

  /** "Reject: Inactive Supplier, Deleted Supplier." */
  private async assertActiveSupplier(supplierId: string) {
    const supplier = await this.suppliersService.findOne(supplierId);
    if (supplier.status !== SupplierStatus.ACTIVE) {
      throw new BadRequestException('Supplier is inactive.');
    }
    return supplier;
  }

  /** "Reject: Inactive Product, Deleted Product." */
  private async assertActiveProduct(productId: string) {
    const product = await this.productsService.findOne(productId);
    if (product.status !== ProductStatus.ACTIVE) {
      throw new BadRequestException('Product is inactive.');
    }
    return product;
  }

  private async generatePoNumber(
    tx: Prisma.TransactionClient,
  ): Promise<string> {
    const result = await tx.$queryRaw<
      { nextval: bigint }[]
    >`SELECT nextval('purchase_order_number_seq')`;
    return `PO-${result[0].nextval.toString().padStart(6, '0')}`;
  }
}
