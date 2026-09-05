import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  PartnerRoleType,
  PaymentStatus,
  Prisma,
  ProductStatus,
  SalesDocumentStatus,
  ShipmentStatus,
  StoreOrderPaymentStatus,
  StoreOrderPaymentType,
  StoreOrderShippingStage,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { NumberingEngineService } from '../numbering/numbering-engine.service';
import { PartnersService } from '../partners/partners.service';
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
import {
  storeOrderItemsTotal,
  storeOrderLineAmount,
} from './store-order-line-amount';
import { CreateStoreOrderDto } from './dto/create-store-order.dto';
import { UpdateStoreOrderDto } from './dto/update-store-order.dto';
import { FindStoreOrdersQueryDto } from './dto/find-store-orders-query.dto';
import { CreateStoreOrderPaymentDto } from './dto/create-store-order-payment.dto';
import {
  CreateStoreOrderNoteDto,
  resolveStoreOrderNoteText,
} from './dto/create-store-order-note.dto';
import { CreateStoreOrderReceiptDto } from './dto/create-store-order-receipt.dto';
import { SetPaymentReviewStatusDto } from './dto/set-payment-review-status.dto';
import { ReportStoreOrderPaymentDto } from './dto/report-store-order-payment.dto';
import { ObjectStorageService } from '../common/storage/object-storage.service';
import { AttachmentsService } from '../common/storage/attachments.service';
import { validateAttachmentUpload } from '../common/storage/file-validation';
import { PhoneNumberService } from '../common/phone/phone-number.service';
import { WorkflowStatusResolverService } from '../workflow/workflow-status-resolver.service';
import { SalesScopeService } from '../sales-scope/sales-scope.service';
import { PAID_PAYMENT_CODES } from '../workflow/workflow-status-map';
import { randomUUID } from 'node:crypto';

const STATUS_DEF_SELECT = {
  id: true,
  code: true,
  name: true,
  nameEn: true,
  color: true,
} as const;

const ORDER_INCLUDE = {
  partner: true,
  currency: true,
  employee: { select: { id: true, fullName: true } },
  paymentStatusDef: { select: STATUS_DEF_SELECT },
  fulfillmentStatus: { select: STATUS_DEF_SELECT },
  items: { include: { product: true } },
  /// Every attempt, newest first — `attachCurrentShippingStatus` reads only
  /// `shipments[0]` for the derived status, but the full array is what the
  /// detail page's Shipment History table renders, and history must never
  /// be hidden/truncated (rule: "never hides old attempts").
  shipments: {
    where: { deletedAt: null },
    orderBy: { attemptNumber: 'desc' as const },
    include: {
      shippingCompany: { select: { id: true, name: true } },
      shippingStatus: {
        select: { id: true, code: true, name: true, color: true },
      },
    },
  },
  invoices: {
    where: { deletedAt: null },
    select: { id: true, invoiceNumber: true, status: true, grandTotal: true },
  },
  payments: {
    where: { deletedAt: null },
    orderBy: { createdAt: 'desc' as const },
    include: {
      attachments: {
        where: { deletedAt: null },
        orderBy: { createdAt: 'asc' as const },
        include: {
          uploadedBy: { select: { fullName: true } },
          attachment: {
            select: {
              id: true,
              originalName: true,
              mimeType: true,
              sizeBytes: true,
              createdAt: true,
            },
          },
        },
      },
    },
  },
  receipts: {
    where: { deletedAt: null },
    orderBy: { uploadedAt: 'desc' as const },
    include: {
      uploadedBy: { select: { fullName: true } },
      attachment: { select: { id: true } },
    },
  },
} satisfies Prisma.StoreOrderInclude;

/**
 * Trimmed variant of ORDER_INCLUDE for `findAll`/list rows — enough for the
 * two-line master row plus the expandable detail panel (line items, address,
 * latest shipment), without pulling payments/receipts/invoices/history.
 */
const ORDER_LIST_INCLUDE = {
  partner: {
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
  paymentStatusDef: { select: STATUS_DEF_SELECT },
  fulfillmentStatus: { select: STATUS_DEF_SELECT },
  items: {
    select: {
      id: true,
      productId: true,
      quantity: true,
      unitPrice: true,
      agreedAmount: true,
      product: { select: { id: true, name: true, sku: true } },
    },
  },
  shipments: {
    where: { deletedAt: null },
    orderBy: { attemptNumber: 'desc' as const },
    take: 1,
    include: {
      shippingCompany: { select: { id: true, name: true } },
      shippingStatus: {
        select: { id: true, code: true, name: true, color: true },
      },
    },
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
    private readonly partnersService: PartnersService,
    private readonly numberingEngine: NumberingEngineService,
    private readonly postingEngine: PostingEngineService,
    private readonly activityService: StoreOrderActivityService,
    private readonly paymentSync: StoreOrderPaymentSyncService,
    private readonly objectStorage: ObjectStorageService,
    private readonly attachments: AttachmentsService,
    private readonly phoneNumberService: PhoneNumberService,
    private readonly statusResolver: WorkflowStatusResolverService,
    private readonly salesScope: SalesScopeService,
  ) {}

  /**
   * Business operation: Create Store Order (Manual entry point — the Import
   * handler builds the same shape and calls this same method for the
   * auto-import path, so both paths always share one create implementation).
   * Partner is resolved via `PartnersService.findOrCreateWithRole` (rule: never a
   * second phone-matching mechanism). `internalOrderId` is always
   * app-generated. `externalOrderId` — when given — is THE unique import
   * identity: a repeat is rejected, naming the existing internalOrderId,
   * never a second row.
   */
  async create(dto: CreateStoreOrderDto, userId?: string) {
    if (dto.externalOrderId) {
      const normalized = dto.externalOrderId.trim().toLocaleLowerCase('en-US');
      const existing = await this.prisma.storeOrder.findFirst({
        where: {
          externalOrderId: { equals: normalized, mode: 'insensitive' },
          deletedAt: null,
        },
      });
      if (existing) {
        throw new BadRequestException({
          code: 'DUPLICATE',
          message: `A Store Order with external order id "${dto.externalOrderId}" already exists (${existing.internalOrderId}).`,
          fields: [{ field: 'externalOrderId', constraints: ['unique'] }],
          internalOrderId: existing.internalOrderId,
        });
      }
      dto.externalOrderId = normalized;
    }

    for (const item of dto.items) {
      await this.assertActiveProduct(item.productId);
    }

    const { partner } = await this.partnersService.findOrCreateWithRole(
      { ...dto.partner, role: PartnerRoleType.CUSTOMER },
      userId,
    );

    const internalOrderId =
      await this.numberingEngine.generateNumber('STORE_ORDER');

    const paymentType = dto.paymentType ?? StoreOrderPaymentType.PREPAID;
    const shippingStage =
      paymentType === StoreOrderPaymentType.CASH_ON_DELIVERY
        ? StoreOrderShippingStage.READY_FOR_SHIPPING
        : StoreOrderShippingStage.NOT_READY;

    let employeeId = dto.employeeId;
    if (userId) {
      const scope = await this.salesScope.resolve(userId);
      if (!employeeId) employeeId = userId;
      if (!this.salesScope.canSetOrderOwner(scope, employeeId)) {
        throw new ForbiddenException(
          'You are not allowed to assign this Store Order to that owner.',
        );
      }
    }

    try {
      const order = await this.prisma.$transaction(async (tx) => {
        const created = await tx.storeOrder.create({
          data: {
            internalOrderId,
            externalOrderId: dto.externalOrderId,
            partnerId: partner.id,
            orderDate: dto.orderDate ? new Date(dto.orderDate) : undefined,
            source: dto.source,
            sourceChannel: dto.sourceChannel,
            employeeId,
            currencyId: dto.currencyId,
            paymentType,
            shippingStage,
            paymentStatusId: this.statusResolver.paymentStatusId(
              StoreOrderPaymentStatus.PAYMENT_PENDING,
            ),
            fulfillmentStatusId:
              this.statusResolver.fulfillmentStatusId(shippingStage),
            notes: dto.notes,
            createdBy: userId,
            updatedBy: userId,
            items: {
              create: dto.items.map((item) => ({
                productId: item.productId,
                quantity: item.quantity,
                unitPrice: item.unitPrice,
                agreedAmount: item.quantity * item.unitPrice,
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

      return this.findOne(order.id, userId);
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
   * `internalOrderId`) is never rewritten. Line items / partner / amounts
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

    const { partner } = await this.partnersService.findOrCreateWithRole(
      { ...dto.partner, role: PartnerRoleType.CUSTOMER },
      userId,
    );

    try {
      await this.prisma.$transaction(async (tx) => {
        await tx.storeOrderItem.deleteMany({ where: { storeOrderId: id } });
        await tx.storeOrder.update({
          where: { id },
          data: {
            partnerId: partner.id,
            orderDate: dto.orderDate ? new Date(dto.orderDate) : undefined,
            employeeId: dto.employeeId,
            currencyId: dto.currencyId,
            paymentType: dto.paymentType ?? StoreOrderPaymentType.PREPAID,
            notes: dto.notes,
            updatedBy: userId,
            items: {
              create: dto.items.map((item) => ({
                productId: item.productId,
                quantity: item.quantity,
                unitPrice: item.unitPrice,
                agreedAmount: item.quantity * item.unitPrice,
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
      return this.findOne(id, userId);
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
      | 'partnerId'
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
      partnerId: query.partnerId,
      paymentStatus: prismaEnumFilter(query.paymentStatus),
      shippingStage: prismaEnumFilter(query.shippingStage),
      source: prismaEnumFilter(query.source),
    };
    if (query.phone) {
      where.partner = {
        OR: [
          { phone: { contains: query.phone } },
          { mobile: { contains: query.phone } },
        ],
      };
    }
    const search = query.search?.trim();
    if (search) {
      // Practical operational search: OMS order number, External Order
      // ID, partner name, and partner phone — the last matched via
      // digit-only candidates (shared `PhoneNumberService.searchCandidates`,
      // the same normalization authority import/sync logic uses) so
      // "564345678", "0564345678", "966564345678", and "+966564345678"
      // all find a partner stored as "+966564345678".
      const phoneCandidates = this.phoneNumberService.searchCandidates(search);
      where.OR = [
        { internalOrderId: { contains: search, mode: 'insensitive' } },
        { externalOrderId: { contains: search, mode: 'insensitive' } },
        { partner: { name: { contains: search, mode: 'insensitive' } } },
        ...phoneCandidates.flatMap((digits) => [
          { partner: { phone: { contains: digits } } },
          { partner: { mobile: { contains: digits } } },
        ]),
      ];
    }
    if (query.dateFrom || query.dateTo) {
      where.orderDate = buildDateRangeFilter(query.dateFrom, query.dateTo);
    }
    return where;
  }

  private async buildScopedFindWhere(
    query: FindStoreOrdersQueryDto,
    userId?: string,
  ): Promise<Prisma.StoreOrderWhereInput> {
    const where = this.buildFindWhere(query);
    if (!userId) return where;
    const scope = await this.salesScope.resolve(userId);
    return { AND: [where, this.salesScope.storeOrderWhere(scope)] };
  }

  async findAll(query: FindStoreOrdersQueryDto, userId?: string) {
    const where = await this.buildScopedFindWhere(query, userId);
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 20;
    const sortField = query.sortBy || 'createdAt';
    const sortDir = query.sortOrder ?? 'desc';
    const orderBy =
      sortField === 'id'
        ? [{ id: sortDir }]
        : [{ [sortField]: sortDir }, { id: 'desc' as const }];
    const [items, total] = await Promise.all([
      this.prisma.storeOrder.findMany({
        where,
        include: ORDER_LIST_INCLUDE,
        orderBy,
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.storeOrder.count({ where }),
    ]);

    return {
      items: await Promise.all(
        items.map((item) => this.attachCurrentShippingStatus(item)),
      ),
      total,
      page,
      pageSize,
    };
  }

  /**
   * "Select all matching filters" / "select the first N" — bare IDs only,
   * same filter/search as `findAll`, ordered the same way (`sortBy`/
   * `sortOrder`) so a caller-supplied `limit` deterministically means "the
   * first N by the current sort," never an arbitrary DB-order subset.
   * Uncapped selection still stops at 10,000 rows — plain id strings, not
   * full records, so this stays cheap even at that ceiling.
   */
  async findAllIds(
    query: Pick<
      FindStoreOrdersQueryDto,
      | 'partnerId'
      | 'phone'
      | 'paymentStatus'
      | 'shippingStage'
      | 'source'
      | 'search'
      | 'dateFrom'
      | 'dateTo'
      | 'sortBy'
      | 'sortOrder'
      | 'limit'
    >,
    userId?: string,
  ) {
    const where = await this.buildScopedFindWhere(query, userId);
    const take = Math.min(query.limit ?? 10_000, 10_000);
    const [rows, total] = await Promise.all([
      this.prisma.storeOrder.findMany({
        where,
        select: { id: true },
        orderBy:
          query.sortBy === 'id'
            ? [{ id: query.sortOrder ?? 'desc' }]
            : [
                {
                  [query.sortBy || 'createdAt']: query.sortOrder ?? 'desc',
                },
                { id: 'desc' as const },
              ],
        take,
      }),
      this.prisma.storeOrder.count({ where }),
    ]);
    return { ids: rows.map((row) => row.id), total };
  }

  async findOne(id: string, userId?: string) {
    const order = await this.prisma.storeOrder.findFirst({
      where: { id, deletedAt: null },
      include: ORDER_INCLUDE,
    });
    if (!order) {
      throw new NotFoundException(`Store Order ${id} not found`);
    }
    if (userId) {
      const scope = await this.salesScope.resolve(userId);
      this.salesScope.assertStoreOrderAccess(scope, order);
    }
    const withStatus = await this.attachCurrentShippingStatus(order);
    return {
      ...withStatus,
      payments: (order.payments ?? []).map((payment) => ({
        ...payment,
        attachments: (payment.attachments ?? []).map((row) => ({
          id: row.id,
          attachmentId: row.attachment?.id ?? null,
          fileName: row.attachment?.originalName ?? row.fileName,
          mimeType: row.attachment?.mimeType ?? null,
          sizeBytes: row.attachment?.sizeBytes ?? null,
          source: row.attachment ? 'UPLOAD' : 'URL',
          fileUrl: row.attachment
            ? `/attachments/${row.attachment.id}/file`
            : row.fileUrl,
          uploadedBy: row.uploadedBy?.fullName ?? null,
          createdAt: row.attachment?.createdAt ?? row.createdAt,
        })),
      })),
      receipts: this.mapReceipts(id, order.receipts),
    };
  }

  /**
   * Order-level current shipping status — catalog row when a shipment exists,
   * otherwise the protected default (`جاهز للشحن`) once the order is ready,
   * otherwise the pre-shipment stage.
   */
  private async attachCurrentShippingStatus<
    T extends {
      shippingStage: StoreOrderShippingStage;
      shipments: {
        status: ShipmentStatus | null;
        shippingStatus?: {
          id: string;
          code: string;
          name: string;
          color: string;
        } | null;
      }[];
      items: {
        quantity: number;
        unitPrice: Prisma.Decimal;
        agreedAmount?: Prisma.Decimal;
      }[];
    },
  >(order: T) {
    const latestShipment = order.shipments[0];
    const catalogStatus =
      latestShipment?.shippingStatus ??
      (order.shippingStage === StoreOrderShippingStage.READY_FOR_SHIPPING
        ? await this.findDefaultShippingStatus()
        : null);
    const currentShippingStatus: ShipmentStatus | StoreOrderShippingStage =
      latestShipment?.status ?? order.shippingStage;
    const total = storeOrderItemsTotal(order.items);
    return {
      ...order,
      currentShippingStatus,
      shippingStatus: catalogStatus,
      total: total.toFixed(2),
    };
  }

  private defaultShippingStatusCache: {
    id: string;
    code: string;
    name: string;
    color: string;
  } | null = null;

  private async findDefaultShippingStatus() {
    if (this.defaultShippingStatusCache) return this.defaultShippingStatusCache;
    const status = await this.prisma.shippingStatus.findFirst({
      where: { isDefault: true, deletedAt: null },
      select: { id: true, code: true, name: true, color: true },
    });
    if (status) this.defaultShippingStatusCache = status;
    return status;
  }

  async update(id: string, dto: UpdateStoreOrderDto, userId?: string) {
    await this.findOne(id, userId);
    if (dto.employeeId && userId) {
      const scope = await this.salesScope.resolve(userId);
      if (!this.salesScope.canSetOrderOwner(scope, dto.employeeId)) {
        throw new ForbiddenException(
          'You are not allowed to assign this Store Order to that owner.',
        );
      }
    }
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
    await this.findOne(id, userId);
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
    await this.findOne(id, userId);
    await this.activityService.log(
      id,
      StoreOrderActivityType.NOTE_ADDED,
      resolveStoreOrderNoteText(dto),
      userId,
    );
    return this.findOne(id, userId);
  }

  /** Business operation: Add Payment — a Store Order can receive many Payments over time (e.g. 3x partial payments); each is a normal `Payment` row with `storeOrderId` set and `leadId` left null, immediately eligible for the existing bank-matching engine untouched. */
  async addPayment(
    id: string,
    dto: CreateStoreOrderPaymentDto,
    userId?: string,
  ) {
    const order = await this.findOne(id, userId);
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

  /**
   * Sales Agent payment report — PENDING Payment + PAYMENT_REVIEW.
   * Does NOT set FULLY_PAID_RECONCILED (that requires verified reconciliation).
   */
  async reportPayment(
    id: string,
    dto: ReportStoreOrderPaymentDto,
    userId?: string,
  ) {
    const order = await this.findOne(id, userId);
    if (order.paymentStatus === StoreOrderPaymentStatus.FULLY_PAID_RECONCILED) {
      throw new BadRequestException(
        'Order is already fully paid and reconciled — no payment report needed.',
      );
    }

    let receivingAccountId = dto.receivingAccountId;
    if (!receivingAccountId) {
      const account = await this.prisma.receivingAccount.findFirst({
        where: { deletedAt: null, isActive: true },
        orderBy: [{ isDefault: 'desc' }, { name: 'asc' }],
      });
      if (!account) {
        throw new BadRequestException(
          'No active Receiving Account configured for payment reporting.',
        );
      }
      receivingAccountId = account.id;
    }

    const payment = await this.prisma.$transaction(async (tx) => {
      const paymentSourceId = await this.resolvePaymentSourceId(dto, tx);
      const created = await this.createPaymentRow(
        id,
        order.currencyId,
        {
          paymentDate: dto.reportedDate,
          amount: dto.reportedAmount,
          paymentSourceId,
          receivingAccountId,
          referenceNumber: dto.reference,
          senderName:
            dto.senderName?.trim() || order.partner?.name || 'Reported',
        },
        userId,
        tx,
      );
      await tx.storeOrder.update({
        where: { id },
        data: {
          paymentStatus: StoreOrderPaymentStatus.PAYMENT_REVIEW,
          paymentStatusId: this.statusResolver.paymentStatusId(
            StoreOrderPaymentStatus.PAYMENT_REVIEW,
          ),
        },
      });
      await this.activityService.log(
        id,
        StoreOrderActivityType.PAYMENT_REPORTED,
        `Payment reported ${created.paymentNumber}` +
          (dto.notes ? `: ${dto.notes}` : ''),
        userId,
        tx,
      );
      return created;
    });

    return { payment, paymentStatus: StoreOrderPaymentStatus.PAYMENT_REVIEW };
  }

  /**
   * Central fulfillment gate — PREPAID requires verified payment;
   * COD may ship before payment.
   */
  async canFulfill(id: string) {
    const order = await this.findOne(id);
    if (order.paymentType === StoreOrderPaymentType.CASH_ON_DELIVERY) {
      return {
        allowed: true,
        settlementMode: 'COD' as const,
        reason: null as string | null,
      };
    }
    const paymentCode =
      order.paymentStatusDef?.code ??
      (order.paymentStatus === StoreOrderPaymentStatus.FULLY_PAID_RECONCILED
        ? 'PAID'
        : order.paymentStatus === StoreOrderPaymentStatus.OVERPAID
          ? 'OVERPAID'
          : 'UNPAID');
    if (PAID_PAYMENT_CODES.has(paymentCode)) {
      return {
        allowed: true,
        settlementMode: 'PREPAID' as const,
        reason: null as string | null,
      };
    }
    return {
      allowed: false,
      settlementMode: 'PREPAID' as const,
      reason:
        'Prepaid orders require verified reconciled payment before fulfillment.',
    };
  }

  /** Business operation: Attach Receipt — URL metadata and/or an uploaded file. */
  async addReceipt(
    id: string,
    dto: CreateStoreOrderReceiptDto,
    userId?: string,
  ) {
    await this.findOne(id, userId);
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
        include: {
          uploadedBy: { select: { fullName: true } },
          attachment: { select: { id: true } },
        },
      });
      await this.activityService.log(
        id,
        StoreOrderActivityType.RECEIPT_ATTACHED,
        `Receipt attached${dto.fileName ? `: ${dto.fileName}` : ''}`,
        userId,
        tx,
      );
      return this.mapReceipt(id, receipt);
    });
  }

  async uploadReceipt(
    id: string,
    file: Express.Multer.File | undefined,
    userId?: string,
    paymentId?: string,
  ) {
    const order = await this.findOne(id, userId);
    if (userId) {
      const scope = await this.salesScope.resolve(userId);
      this.salesScope.assertPaymentEvidenceAccess(scope, order);
    }
    if (paymentId) {
      if (!userId) {
        throw new BadRequestException('Authentication required.');
      }
      await this.attachments.uploadForPayment(paymentId, file, userId);
      const receipt = await this.prisma.storeOrderReceipt.findFirst({
        where: { storeOrderId: id, paymentId, deletedAt: null },
        orderBy: { uploadedAt: 'desc' },
        include: {
          uploadedBy: { select: { fullName: true } },
          attachment: { select: { id: true } },
        },
      });
      if (!receipt) {
        throw new BadRequestException('تعذر رفع الإيصال، حاول مرة أخرى');
      }
      await this.activityService.log(
        id,
        StoreOrderActivityType.RECEIPT_ATTACHED,
        `Receipt uploaded: ${receipt.fileName ?? ''}`.trim(),
        userId,
      );
      return this.mapReceipt(id, receipt);
    }
    const validated = validateAttachmentUpload(file);
    const storageKey = `store-order-receipts/${id}/${randomUUID()}${validated.extension}`;
    await this.objectStorage.put(storageKey, file!.buffer, validated.mimeType);
    try {
      return await this.prisma.$transaction(async (tx) => {
        const attachment = userId
          ? await tx.attachment.create({
              data: {
                fileName: `${randomUUID()}${validated.extension}`,
                originalName: validated.originalName,
                mimeType: validated.mimeType,
                sizeBytes: validated.sizeBytes,
                storageProvider: this.objectStorage.provider(),
                storageKey,
                uploadedById: userId,
                finalizedAt: new Date(),
              },
            })
          : null;
        const receipt = await tx.storeOrderReceipt.create({
          data: {
            storeOrderId: id,
            attachmentId: attachment?.id,
            fileUrl: `storage:${storageKey}`,
            fileName: validated.originalName,
            mimeType: validated.mimeType,
            fileSizeBytes: validated.sizeBytes,
            storageKey,
            uploadedById: userId,
          },
          include: {
            uploadedBy: { select: { fullName: true } },
            attachment: { select: { id: true } },
          },
        });
        await this.activityService.log(
          id,
          StoreOrderActivityType.RECEIPT_ATTACHED,
          `Receipt uploaded: ${validated.originalName}`,
          userId,
          tx,
        );
        return this.mapReceipt(id, receipt);
      });
    } catch (error) {
      await this.objectStorage.delete(storageKey);
      throw error;
    }
  }

  async getReceiptFile(id: string, receiptId: string, userId?: string) {
    const order = await this.findOne(id, userId);
    if (userId) {
      const scope = await this.salesScope.resolve(userId);
      this.salesScope.assertPaymentEvidenceAccess(scope, order);
    } else {
      throw new ForbiddenException('ليس لديك صلاحية لعرض هذا الإيصال');
    }
    const receipt = await this.prisma.storeOrderReceipt.findFirst({
      where: { id: receiptId, storeOrderId: id, deletedAt: null },
    });
    if (!receipt) {
      throw new NotFoundException('Attachment not found.');
    }
    if (receipt.attachmentId) {
      return this.attachments.getFile(receipt.attachmentId, userId);
    }
    if (!receipt.storageKey) {
      throw new BadRequestException('This attachment is an external URL.');
    }
    const body = await this.objectStorage.get(receipt.storageKey);
    return {
      body,
      mimeType: receipt.mimeType ?? 'application/octet-stream',
      fileName: receipt.fileName ?? 'attachment',
    };
  }

  async archiveReceipt(id: string, receiptId: string, userId?: string) {
    const order = await this.findOne(id, userId);
    const receipt = await this.prisma.storeOrderReceipt.findFirst({
      where: { id: receiptId, storeOrderId: id, deletedAt: null },
      include: { payment: { select: { id: true, status: true } } },
    });
    if (!receipt) {
      throw new NotFoundException('Attachment not found.');
    }
    if (userId) {
      const scope = await this.salesScope.resolve(userId);
      this.salesScope.assertPaymentEvidenceAccess(scope, order);
      const locked = receipt.payment?.status === PaymentStatus.VERIFIED;
      if (locked && !scope.canManagePaymentEvidence) {
        throw new ForbiddenException(
          'لا يمكن حذف إيصال سداد بعد التحقق إلا بصلاحية مالية.',
        );
      }
    }
    const locked = receipt.payment?.status === PaymentStatus.VERIFIED;
    await this.prisma.$transaction(async (tx) => {
      await tx.storeOrderReceipt.update({
        where: { id: receiptId },
        data: { deletedAt: new Date() },
      });
      if (receipt.attachmentId) {
        await tx.attachment.update({
          where: { id: receipt.attachmentId },
          data: { deletedAt: new Date(), deletedById: userId },
        });
        await tx.paymentAttachment.updateMany({
          where: { attachmentId: receipt.attachmentId, deletedAt: null },
          data: { deletedAt: new Date() },
        });
      }
      await this.activityService.log(
        id,
        StoreOrderActivityType.RECEIPT_REMOVED,
        `Receipt removed${receipt.fileName ? `: ${receipt.fileName}` : ''}`,
        userId,
        tx,
      );
    });
    if (!locked && receipt.storageKey) {
      await this.objectStorage.delete(receipt.storageKey);
    }
    return { id: receiptId };
  }

  private mapReceipts(
    orderId: string,
    receipts: Array<{
      id: string;
      paymentId?: string | null;
      fileUrl: string;
      fileName: string | null;
      mimeType: string | null;
      fileSizeBytes: number | null;
      storageKey: string | null;
      uploadedAt: Date;
      uploadedBy: { fullName: string } | null;
      attachment?: { id: string } | null;
    }>,
  ) {
    return receipts.map((receipt) => this.mapReceipt(orderId, receipt));
  }

  private mapReceipt(
    orderId: string,
    receipt: {
      id: string;
      paymentId?: string | null;
      fileUrl: string;
      fileName: string | null;
      mimeType?: string | null;
      fileSizeBytes?: number | null;
      storageKey?: string | null;
      uploadedAt: Date;
      uploadedBy?: { fullName: string } | null;
      attachment?: { id: string } | null;
    },
  ) {
    const uploaded = Boolean(receipt.storageKey || receipt.attachment);
    return {
      id: receipt.id,
      paymentId: receipt.paymentId ?? null,
      attachmentId: receipt.attachment?.id ?? null,
      fileUrl: receipt.attachment
        ? `/attachments/${receipt.attachment.id}/file`
        : uploaded
          ? `/store-orders/${orderId}/receipts/${receipt.id}/file`
          : receipt.fileUrl,
      fileName: receipt.fileName,
      mimeType: receipt.mimeType ?? null,
      fileSizeBytes: receipt.fileSizeBytes ?? null,
      source: uploaded ? 'UPLOAD' : 'URL',
      createdAt: receipt.uploadedAt,
      createdBy: receipt.uploadedBy?.fullName ?? null,
    };
  }

  private async createPaymentRow(
    storeOrderId: string,
    orderCurrencyId: string,
    dto: CreateStoreOrderPaymentDto,
    userId: string | undefined,
    tx: Prisma.TransactionClient,
  ) {
    const paymentSourceId = await this.resolvePaymentSourceId(dto, tx);
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
        paymentSourceId,
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

  private async resolvePaymentSourceId(
    dto: { paymentSourceId?: string; paymentMethodId?: string },
    tx: Prisma.TransactionClient,
  ): Promise<string> {
    if (dto.paymentSourceId) {
      const source = await tx.paymentSource.findFirst({
        where: { id: dto.paymentSourceId, deletedAt: null, isActive: true },
      });
      if (!source) {
        throw new BadRequestException(
          'Payment source not found or is not active.',
        );
      }
      return source.id;
    }
    if (dto.paymentMethodId) {
      const method = await tx.paymentMethod.findFirst({
        where: { id: dto.paymentMethodId, deletedAt: null },
      });
      if (!method) {
        throw new BadRequestException('Payment method not found.');
      }
      const byName = await tx.paymentSource.findFirst({
        where: {
          deletedAt: null,
          isActive: true,
          name: { equals: method.name, mode: 'insensitive' },
        },
      });
      if (byName) return byName.id;
    }
    const fallback = await tx.paymentSource.findFirst({
      where: { deletedAt: null, isActive: true },
      orderBy: [{ isDefault: 'desc' }, { sortOrder: 'asc' }],
    });
    if (!fallback) {
      throw new BadRequestException('No active Payment Source is configured.');
    }
    return fallback.id;
  }

  /**
   * Outstanding uses verified/reconciled payments only — pending claims
   * do not reduce what Finance still needs to confirm.
   */
  async paymentContext(id: string, userId?: string) {
    const order = await this.findOne(id, userId);
    const total = storeOrderItemsTotal(order.items);
    const verified = await this.prisma.payment.aggregate({
      where: {
        storeOrderId: id,
        status: PaymentStatus.VERIFIED,
        deletedAt: null,
      },
      _sum: { amount: true },
    });
    const paid = Number(verified._sum.amount ?? 0);
    const outstanding = Math.max(Math.round((total - paid) * 100) / 100, 0);
    return {
      total: total.toFixed(2),
      paid: paid.toFixed(2),
      outstanding: outstanding.toFixed(2),
      currencyId: order.currencyId,
      paymentStatus: order.paymentStatus,
    };
  }

  /** Business operation: Set Payment Review Status — manual escalation, see `SetPaymentReviewStatusDto`. */
  async setPaymentReviewStatus(
    id: string,
    dto: SetPaymentReviewStatusDto,
    userId?: string,
  ) {
    await this.findOne(id, userId);
    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.storeOrder.update({
        where: { id },
        data: {
          paymentStatus: dto.status,
          paymentStatusId: this.statusResolver.paymentStatusId(dto.status),
        },
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
    const order = await this.findOne(id, userId);
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
        agreedAmount: storeOrderLineAmount(item),
      }),
    );
    const totals = computeSalesDocumentTotals(computedLines);

    const invoiceNumber =
      await this.numberingEngine.generateNumber('SALES_INVOICE');

    const invoice = await this.prisma.$transaction(async (tx) => {
      const created = await tx.salesInvoice.create({
        data: {
          invoiceNumber,
          partnerId: order.partnerId,
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
