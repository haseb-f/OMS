import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  PaymentStatus,
  Prisma,
  ProductStatus,
  SalesDocumentStatus,
  ShipmentStatus,
  StoreOrderPaymentStatus,
  StoreOrderShippingStage,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { NumberingEngineService } from '../numbering/numbering-engine.service';
import { CustomersService } from '../customers/customers.service';
import { PostingEngineService } from '../accounting/posting-engine/posting-engine.service';
import {
  computeSalesDocumentTotals,
  computeSalesLine,
} from '../sales/shared/sales-totals.util';
import { buildDateRangeFilter } from '../sales/shared/sales-list-query.util';
import { prismaEnumFilter } from '../common/query/enum-list';
import {
  StoreOrderActivityService,
  StoreOrderActivityType,
} from './activities/store-order-activity.service';
import { StoreOrderPaymentSyncService } from './store-order-payment-sync.service';
import { CreateStoreOrderDto } from './dto/create-store-order.dto';
import { UpdateStoreOrderDto } from './dto/update-store-order.dto';
import { FindStoreOrdersQueryDto } from './dto/find-store-orders-query.dto';
import { CreateStoreOrderPaymentDto } from './dto/create-store-order-payment.dto';
import { CreateStoreOrderNoteDto } from './dto/create-store-order-note.dto';
import { CreateStoreOrderReceiptDto } from './dto/create-store-order-receipt.dto';
import { SetPaymentReviewStatusDto } from './dto/set-payment-review-status.dto';

const ORDER_INCLUDE = {
  customer: true,
  currency: true,
  employee: { select: { id: true, fullName: true } },
  items: { include: { product: true } },
  /// Every attempt, newest first — `attachCurrentShippingStatus` reads only
  /// `shipments[0]` for the derived status, but the full array is what the
  /// detail page's Shipment History table renders, and history must never
  /// be hidden/truncated (rule: "never hides old attempts").
  shipments: {
    where: { deletedAt: null },
    orderBy: { attemptNumber: 'desc' as const },
  },
  invoices: {
    where: { deletedAt: null },
    select: { id: true, invoiceNumber: true, status: true, grandTotal: true },
  },
  payments: {
    where: { deletedAt: null },
    orderBy: { createdAt: 'desc' as const },
  },
} satisfies Prisma.StoreOrderInclude;

/**
 * Trimmed variant of ORDER_INCLUDE for `findAll`/list rows — enough for the
 * two-line master row plus the expandable detail panel (line items, address,
 * latest shipment), without pulling payments/receipts/invoices/history.
 */
const ORDER_LIST_INCLUDE = {
  customer: {
    select: {
      id: true,
      name: true,
      phone: true,
      mobile: true,
      email: true,
      address: true,
      city: true,
    },
  },
  currency: { select: { id: true, code: true, name: true, symbol: true } },
  items: {
    select: {
      id: true,
      productId: true,
      quantity: true,
      unitPrice: true,
      product: { select: { id: true, name: true, sku: true } },
    },
  },
  shipments: {
    where: { deletedAt: null },
    orderBy: { attemptNumber: 'desc' as const },
    take: 1,
    include: { shippingCompany: { select: { id: true, name: true } } },
  },
  payments: {
    where: { deletedAt: null },
    orderBy: { paymentDate: 'desc' as const },
    take: 1,
    select: {
      id: true,
      paymentNumber: true,
      amount: true,
      status: true,
      paymentDate: true,
      referenceNumber: true,
      paymentSource: { select: { id: true, name: true } },
    },
  },
} satisfies Prisma.StoreOrderInclude;

/**
 * Independent storefront/marketplace order pipeline — never routed through
 * the Lead->SalesOrder pipeline (`leads/`, `sales-orders/`) and never part
 * of the B2B Sales pipeline (`sales/`). See the schema's `StoreOrder` model
 * comment for the full architecture rationale.
 */
@Injectable()
export class StoreOrdersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly customersService: CustomersService,
    private readonly numberingEngine: NumberingEngineService,
    private readonly postingEngine: PostingEngineService,
    private readonly activityService: StoreOrderActivityService,
    private readonly paymentSync: StoreOrderPaymentSyncService,
  ) {}

  /**
   * Business operation: Create Store Order (Manual entry point — the Import
   * handler builds the same shape and calls this same method for the
   * auto-import path, so both paths always share one create implementation).
   * Customer is resolved via `CustomersService.findOrCreate` (rule: never a
   * second phone-matching mechanism). `internalOrderId` is always
   * app-generated. `externalOrderId` — when given — is THE unique import
   * identity: a repeat is rejected, naming the existing internalOrderId,
   * never a second row.
   */
  async create(dto: CreateStoreOrderDto, userId?: string) {
    if (dto.externalOrderId) {
      const existing = await this.prisma.storeOrder.findFirst({
        where: { externalOrderId: dto.externalOrderId, deletedAt: null },
      });
      if (existing) {
        throw new BadRequestException({
          code: 'DUPLICATE',
          message: `A Store Order with external order id "${dto.externalOrderId}" already exists (${existing.internalOrderId}).`,
          fields: [{ field: 'externalOrderId', constraints: ['unique'] }],
          internalOrderId: existing.internalOrderId,
        });
      }
    }

    for (const item of dto.items) {
      await this.assertActiveProduct(item.productId);
    }

    const { customer } = await this.customersService.findOrCreate(
      dto.customer,
      userId,
    );

    const internalOrderId =
      await this.numberingEngine.generateNumber('STORE_ORDER');

    try {
      const order = await this.prisma.$transaction(async (tx) => {
        const created = await tx.storeOrder.create({
          data: {
            internalOrderId,
            externalOrderId: dto.externalOrderId,
            customerId: customer.id,
            orderDate: dto.orderDate ? new Date(dto.orderDate) : undefined,
            source: dto.source,
            sourceChannel: dto.sourceChannel,
            employeeId: dto.employeeId,
            currencyId: dto.currencyId,
            notes: dto.notes,
            createdBy: userId,
            updatedBy: userId,
            items: {
              create: dto.items.map((item) => ({
                productId: item.productId,
                quantity: item.quantity,
                unitPrice: item.unitPrice,
              })),
            },
          },
        });

        await this.activityService.log(
          created.id,
          StoreOrderActivityType.ORDER_CREATED,
          `Store Order ${created.internalOrderId} created`,
          userId,
          tx,
        );

        if (dto.payment) {
          await this.createPaymentRow(
            created.id,
            created.currencyId,
            dto.payment,
            userId,
            tx,
          );
        }

        return created;
      });

      if (dto.payment) {
        await this.paymentSync.recompute(order.id);
      }

      return this.findOne(order.id);
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2003'
      ) {
        throw new BadRequestException(
          'Invalid product, employee, or currency reference.',
        );
      }
      throw error;
    }
  }

  /**
   * Google Sheets incremental reconcile — applies a later source revision to
   * an already-imported Store Order. Identity (`externalOrderId` /
   * `internalOrderId`) is never rewritten. Line items / customer / amounts
   * stay frozen once payment, shipping, or invoicing has started, matching
   * the existing post-create immutability of those fields.
   */
  async applyImportedSource(
    id: string,
    dto: CreateStoreOrderDto,
    userId?: string,
  ) {
    const order = await this.prisma.storeOrder.findFirst({
      where: { id, deletedAt: null },
      include: {
        invoices: {
          where: { deletedAt: null },
          select: { id: true },
        },
        shipments: {
          where: { deletedAt: null },
          select: { id: true },
        },
        payments: {
          where: { deletedAt: null },
          select: { id: true },
        },
      },
    });
    if (!order) {
      throw new NotFoundException(`Store Order ${id} not found`);
    }
    if (
      order.paymentStatus !== StoreOrderPaymentStatus.PAYMENT_PENDING ||
      order.shippingStage !== StoreOrderShippingStage.NOT_READY ||
      order.invoices.length > 0 ||
      order.shipments.length > 0 ||
      order.payments.length > 0
    ) {
      throw new BadRequestException(
        'This Store Order can no longer be updated from Google Sheets because payment, shipping, or invoicing has already started.',
      );
    }

    for (const item of dto.items) {
      await this.assertActiveProduct(item.productId);
    }

    const { customer } = await this.customersService.findOrCreate(
      dto.customer,
      userId,
    );

    try {
      await this.prisma.$transaction(async (tx) => {
        await tx.storeOrderItem.deleteMany({ where: { storeOrderId: id } });
        await tx.storeOrder.update({
          where: { id },
          data: {
            customerId: customer.id,
            orderDate: dto.orderDate ? new Date(dto.orderDate) : undefined,
            employeeId: dto.employeeId,
            currencyId: dto.currencyId,
            notes: dto.notes,
            updatedBy: userId,
            items: {
              create: dto.items.map((item) => ({
                productId: item.productId,
                quantity: item.quantity,
                unitPrice: item.unitPrice,
              })),
            },
          },
        });
        await this.activityService.log(
          id,
          StoreOrderActivityType.ORDER_UPDATED,
          'Store Order updated from Google Sheets source',
          userId,
          tx,
        );
      });
      return this.findOne(id);
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2003'
      ) {
        throw new BadRequestException(
          'Invalid product, employee, or currency reference.',
        );
      }
      throw error;
    }
  }

  private buildFindWhere(
    query: Pick<
      FindStoreOrdersQueryDto,
      | 'customerId'
      | 'phone'
      | 'paymentStatus'
      | 'shippingStage'
      | 'source'
      | 'search'
      | 'dateFrom'
      | 'dateTo'
    >,
  ): Prisma.StoreOrderWhereInput {
    const where: Prisma.StoreOrderWhereInput = {
      deletedAt: null,
      customerId: query.customerId,
      paymentStatus: prismaEnumFilter(query.paymentStatus),
      shippingStage: prismaEnumFilter(query.shippingStage),
      source: prismaEnumFilter(query.source),
    };
    if (query.phone) {
      where.customer = {
        OR: [
          { phone: { contains: query.phone } },
          { mobile: { contains: query.phone } },
        ],
      };
    }
    if (query.search) {
      where.OR = [
        { internalOrderId: { contains: query.search, mode: 'insensitive' } },
        { externalOrderId: { contains: query.search, mode: 'insensitive' } },
        {
          customer: { name: { contains: query.search, mode: 'insensitive' } },
        },
      ];
    }
    if (query.dateFrom || query.dateTo) {
      where.orderDate = buildDateRangeFilter(query.dateFrom, query.dateTo);
    }
    return where;
  }

  async findAll(query: FindStoreOrdersQueryDto) {
    const where = this.buildFindWhere(query);
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 20;
    const [items, total] = await Promise.all([
      this.prisma.storeOrder.findMany({
        where,
        include: ORDER_LIST_INCLUDE,
        orderBy: { [query.sortBy || 'createdAt']: query.sortOrder ?? 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.storeOrder.count({ where }),
    ]);

    return {
      items: items.map((item) => this.attachCurrentShippingStatus(item)),
      total,
      page,
      pageSize,
    };
  }

  /** "Select all matching filters" — bare IDs only, same filter/search as `findAll`. */
  async findAllIds(
    query: Pick<
      FindStoreOrdersQueryDto,
      | 'customerId'
      | 'phone'
      | 'paymentStatus'
      | 'shippingStage'
      | 'source'
      | 'search'
      | 'dateFrom'
      | 'dateTo'
    >,
  ) {
    const where = this.buildFindWhere(query);
    const [rows, total] = await Promise.all([
      this.prisma.storeOrder.findMany({
        where,
        select: { id: true },
        take: 10_000,
      }),
      this.prisma.storeOrder.count({ where }),
    ]);
    return { ids: rows.map((row) => row.id), total };
  }

  async findOne(id: string) {
    const order = await this.prisma.storeOrder.findFirst({
      where: { id, deletedAt: null },
      include: ORDER_INCLUDE,
    });
    if (!order) {
      throw new NotFoundException(`Store Order ${id} not found`);
    }
    return this.attachCurrentShippingStatus(order);
  }

  /**
   * Order-level "current shipping status" (rule 10) — always derived, never
   * stored: the latest non-superseded Shipment's own status when one
   * exists, otherwise the order's own pre-shipment `shippingStage`.
   */
  private attachCurrentShippingStatus<
    T extends {
      shippingStage: StoreOrderShippingStage;
      shipments: { status: ShipmentStatus | null }[];
      items: { quantity: number; unitPrice: Prisma.Decimal }[];
    },
  >(order: T) {
    const latestShipment = order.shipments[0];
    const currentShippingStatus: ShipmentStatus | StoreOrderShippingStage =
      latestShipment?.status ?? order.shippingStage;
    const total = order.items.reduce(
      (sum, item) => sum + item.quantity * Number(item.unitPrice),
      0,
    );
    return { ...order, currentShippingStatus, total: total.toFixed(2) };
  }

  async update(id: string, dto: UpdateStoreOrderDto, userId?: string) {
    await this.findOne(id);
    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.storeOrder.update({
        where: { id },
        data: {
          notes: dto.notes,
          employeeId: dto.employeeId,
          sourceChannel: dto.sourceChannel,
          updatedBy: userId,
        },
      });
      await this.activityService.log(
        id,
        StoreOrderActivityType.ORDER_UPDATED,
        'Store Order updated',
        userId,
        tx,
      );
      return updated;
    });
  }

  /** Business operation: Archive. Soft-delete only — schema has no hard delete anywhere in this pipeline. */
  async archive(id: string, userId?: string) {
    await this.findOne(id);
    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.storeOrder.update({
        where: { id },
        data: { deletedAt: new Date(), updatedBy: userId },
      });
      await this.activityService.log(
        id,
        StoreOrderActivityType.ORDER_ARCHIVED,
        'Store Order archived',
        userId,
        tx,
      );
      return updated;
    });
  }

  /** Business operation: Add Internal Note — logged directly as a timeline entry (no dedicated Note table on this model). */
  async addNote(id: string, dto: CreateStoreOrderNoteDto, userId?: string) {
    await this.findOne(id);
    return this.activityService.log(
      id,
      StoreOrderActivityType.NOTE_ADDED,
      dto.text,
      userId,
    );
  }

  /** Business operation: Add Payment — a Store Order can receive many Payments over time (e.g. 3x partial payments); each is a normal `Payment` row with `storeOrderId` set and `leadId` left null, immediately eligible for the existing bank-matching engine untouched. */
  async addPayment(
    id: string,
    dto: CreateStoreOrderPaymentDto,
    userId?: string,
  ) {
    const order = await this.findOne(id);
    const payment = await this.prisma.$transaction(async (tx) => {
      const created = await this.createPaymentRow(
        id,
        order.currencyId,
        dto,
        userId,
        tx,
      );
      await this.activityService.log(
        id,
        StoreOrderActivityType.PAYMENT_ADDED,
        `Payment ${created.paymentNumber} added`,
        userId,
        tx,
      );
      return created;
    });
    await this.paymentSync.recompute(id);
    return payment;
  }

  /** Business operation: Attach Receipt — same "paste a URL" convention as every other attachment in this app; optionally links to the specific Payment it evidences. */
  async addReceipt(
    id: string,
    dto: CreateStoreOrderReceiptDto,
    userId?: string,
  ) {
    await this.findOne(id);
    if (dto.paymentId) {
      const payment = await this.prisma.payment.findFirst({
        where: { id: dto.paymentId, storeOrderId: id, deletedAt: null },
      });
      if (!payment) {
        throw new BadRequestException('Payment not found on this Store Order.');
      }
    }
    return this.prisma.$transaction(async (tx) => {
      const receipt = await tx.storeOrderReceipt.create({
        data: {
          storeOrderId: id,
          paymentId: dto.paymentId,
          fileUrl: dto.fileUrl,
          fileName: dto.fileName,
          uploadedById: userId,
        },
      });
      await this.activityService.log(
        id,
        StoreOrderActivityType.RECEIPT_ATTACHED,
        `Receipt attached${dto.fileName ? `: ${dto.fileName}` : ''}`,
        userId,
        tx,
      );
      return receipt;
    });
  }

  private async createPaymentRow(
    storeOrderId: string,
    orderCurrencyId: string,
    dto: CreateStoreOrderPaymentDto,
    userId: string | undefined,
    tx: Prisma.TransactionClient,
  ) {
    const paymentSource = await tx.paymentSource.findFirst({
      where: { id: dto.paymentSourceId, deletedAt: null, isActive: true },
    });
    if (!paymentSource) {
      throw new BadRequestException(
        'Payment source not found or is not active.',
      );
    }
    const receivingAccount = await tx.receivingAccount.findFirst({
      where: { id: dto.receivingAccountId, deletedAt: null, isActive: true },
    });
    if (!receivingAccount) {
      throw new BadRequestException(
        'Receiving account not found or is not active.',
      );
    }

    const paymentNumber = await this.numberingEngine.generateNumber(
      'PAYMENT',
      undefined,
      tx,
    );
    return tx.payment.create({
      data: {
        paymentNumber,
        storeOrderId,
        paymentDate: new Date(dto.paymentDate),
        receivedDate: dto.receivedDate ? new Date(dto.receivedDate) : undefined,
        amount: dto.amount,
        currencyId: dto.currencyId ?? orderCurrencyId,
        paymentSourceId: dto.paymentSourceId,
        receivingAccountId: dto.receivingAccountId,
        referenceNumber: dto.referenceNumber,
        senderName: dto.senderName,
        bankAccount: dto.bankAccount,
        status: PaymentStatus.PENDING,
        createdBy: userId,
        updatedBy: userId,
      },
    });
  }

  /** Business operation: Set Payment Review Status — manual escalation, see `SetPaymentReviewStatusDto`. */
  async setPaymentReviewStatus(
    id: string,
    dto: SetPaymentReviewStatusDto,
    userId?: string,
  ) {
    await this.findOne(id);
    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.storeOrder.update({
        where: { id },
        data: { paymentStatus: dto.status },
      });
      await this.activityService.log(
        id,
        StoreOrderActivityType.PAYMENT_STATUS_CHANGED,
        `Payment status manually set to ${dto.status}`,
        userId,
        tx,
      );
      return updated;
    });
  }

  /**
   * Business operation: Generate Invoice — only callable once
   * `paymentStatus === FULLY_PAID_RECONCILED`. Creates one `SalesInvoice`
   * (status CONFIRMED directly — this is one explicit, atomic business
   * operation, not the multi-step B2B Draft->Approved->Confirmed workflow)
   * and posts it through the existing central `PostingEngineService`,
   * reusing `SalesInvoicePostingProvider` completely unmodified (it reads
   * only the SalesInvoice/SalesInvoiceItem rows themselves — no dependency
   * on `salesOrderId` being a B2B order). Never auto-called on import or on
   * payment alone.
   */
  async generateInvoice(id: string, userId?: string) {
    const order = await this.findOne(id);
    if (order.paymentStatus !== StoreOrderPaymentStatus.FULLY_PAID_RECONCILED) {
      throw new BadRequestException(
        'Invoice can only be generated once the order is Fully Paid & Reconciled.',
      );
    }
    const existingInvoice = await this.prisma.salesInvoice.findFirst({
      where: { storeOrderId: id, deletedAt: null },
    });
    if (existingInvoice) {
      throw new BadRequestException({
        code: 'DUPLICATE',
        message: `Store Order ${order.internalOrderId} already has an invoice (${existingInvoice.invoiceNumber}).`,
        fields: [],
      });
    }

    // Default warehouse resolution (rule 7): Product.preferredWarehouseId
    // when set, else the first active Warehouse ordered by name.
    const needsDefaultWarehouse = order.items.some(
      (item) => !item.product.preferredWarehouseId,
    );
    const defaultWarehouse = needsDefaultWarehouse
      ? await this.prisma.warehouse.findFirst({
          where: { isActive: true, deletedAt: null },
          orderBy: [{ name: 'asc' }, { createdAt: 'asc' }],
        })
      : null;
    if (needsDefaultWarehouse && !defaultWarehouse) {
      throw new BadRequestException(
        'No active Warehouse is configured to default Store Order invoice lines to.',
      );
    }

    const computedLines = order.items.map((item) =>
      computeSalesLine({
        quantity: item.quantity,
        unitPrice: Number(item.unitPrice),
      }),
    );
    const totals = computeSalesDocumentTotals(computedLines);

    const invoiceNumber =
      await this.numberingEngine.generateNumber('SALES_INVOICE');

    const invoice = await this.prisma.$transaction(async (tx) => {
      const created = await tx.salesInvoice.create({
        data: {
          invoiceNumber,
          customerId: order.customerId,
          storeOrderId: order.id,
          currencyId: order.currencyId,
          referenceNumber: order.internalOrderId,
          status: SalesDocumentStatus.CONFIRMED,
          confirmedAt: new Date(),
          confirmedBy: userId ?? null,
          ...totals,
          createdBy: userId,
          updatedBy: userId,
          items: {
            create: order.items.map((item, index) => ({
              productId: item.productId,
              warehouseId:
                item.product.preferredWarehouseId ?? defaultWarehouse!.id,
              unitId: item.product.unitId,
              quantity: item.quantity,
              unitPrice: item.unitPrice,
              taxAmount: computedLines[index].taxAmount,
              lineTotal: computedLines[index].lineTotal,
            })),
          },
        },
      });

      await this.postingEngine.post('SALES_INVOICE', created.id, userId, tx);

      await this.activityService.log(
        id,
        StoreOrderActivityType.INVOICE_GENERATED,
        `Sales Invoice ${created.invoiceNumber} generated`,
        userId,
        tx,
      );

      return created;
    });

    return invoice;
  }

  private async assertActiveProduct(productId: string) {
    const product = await this.prisma.product.findFirst({
      where: { id: productId, status: ProductStatus.ACTIVE, deletedAt: null },
    });
    if (!product) {
      throw new BadRequestException(
        `Product ${productId} not found or is not active.`,
      );
    }
    return product;
  }
}
