import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  Optional,
} from '@nestjs/common';
import {
  PartnerRoleType,
  PaymentStatus,
  Prisma,
  ProductStatus,
  SalesDocumentStatus,
  ShipmentStatus,
  StoreOrderFulfillmentMethod,
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
import { resolveStoreOrderLineWarehouses } from './store-order-warehouse.util';
import { resolveTaxesById } from '../taxes/document-tax';
import { buildDateRangeFilter } from '../sales/shared/sales-list-query.util';
import { prismaEnumFilter } from '../common/query/enum-list';
import {
  StoreOrderActivityService,
  StoreOrderActivityType,
} from './activities/store-order-activity.service';
import { StoreOrderPaymentSyncService } from './store-order-payment-sync.service';
import {
  derivedUnitPrice,
  storeOrderPayableTotal,
  storeOrderLineAmount,
} from './store-order-line-amount';
import {
  assertCanAcceptPayment,
  assertPaymentCurrency,
  computeStoreOrderSettlement,
  lockStoreOrderRow,
  serializeSettlement,
} from './store-order-payment-settlement.util';
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
import { SetStoreOrderLineAmountsDto } from './dto/set-line-amounts.dto';
import { ObjectStorageService } from '../common/storage/object-storage.service';
import { AttachmentsService } from '../common/storage/attachments.service';
import { validateAttachmentUpload } from '../common/storage/file-validation';
import { PhoneNumberService } from '../common/phone/phone-number.service';
import { WorkflowStatusResolverService } from '../workflow/workflow-status-resolver.service';
import { SalesScopeService } from '../sales-scope/sales-scope.service';
import { ProductsService } from '../products/products.service';
import { InventoryService } from '../inventory/inventory.service';
import { FulfillmentCostService } from '../fulfillment-cost-rules/fulfillment-cost.service';
import { StoreOrderCollectionService } from '../accounting/store-order-collection/store-order-collection.service';
import { OrderEconomicsService } from './order-economics/order-economics.service';
import { AccountMappingService } from '../accounting/account-mapping/account-mapping.service';
import { evaluateFulfillmentGate } from './store-order-fulfillment-gate';
import {
  ensureShippingQueued,
  readShippingHandoff,
} from './shipments/shipping-handoff';
import {
  recomputeDeclaredPaymentStatus,
  resolvePaymentSourceId,
  standingClaimsTotal,
} from './payment-declaration/payment-declaration.core';
import { randomUUID } from 'node:crypto';
import { findArabicNormalizedIds } from '../common/text/arabic-search.query';
import { agentUnprocessable } from '../agents/common/agent-errors';
import { AgentFulfillmentService } from '../agents/finance/agent-fulfillment.service';
import { resolveAgentCustomerPartner } from '../agents/orders/agent-customer';
import {
  assertOwnerAffiliation,
  STORE_ORDER_OWNER_ERRORS,
} from '../agents/common/agent-affiliation';
import { assertCompanyOwnedProduct } from '../products/assert-company-owned-products.util';
import { BULK_LIMITS } from '../common/bulk/bulk-limits';
import {
  assertReplayable,
  CROSS_SCOPE_REUSE_OUTCOME,
  duplicateOrderColumns,
  logDuplicateDecision,
  type DuplicateOutcome,
} from './duplicates/duplicate-outcome';
import {
  agentOrderActivityDetails,
  agentOrderColumns,
  agentOrderInitialStage,
  agentOrderItems,
  agentShippingOverrideDetails,
  type AgentOrderPersistInput,
} from '../agents/orders/agent-order-persist';

/**
 * Agents milestone (spec §7): an agent order's payments are recorded only
 * through the declaration flow with an authorized agent destination, so each
 * claim carries its agent and destination ownership.
 */
function assertNotAgentOrderPayment(agentId: string | null) {
  if (agentId) {
    throw agentUnprocessable(
      'AGENT_ORDER_USE_DECLARATION',
      'سجّل دفعات طلبات الوكلاء من خلال إفادة الدفع مع وجهة الدفع المعتمدة',
      'Record agent-order payments through the payment declaration with an authorized agent destination.',
    );
  }
}

/** Customer (Partner) name for the shared Arabic-normalized search (`common/text/arabic-search.ts`). */
export const CUSTOMER_NAME_NORMALIZED_SEARCH = {
  table: 'partners',
  columns: ['name'],
} as const;

const STATUS_DEF_SELECT = {
  id: true,
  code: true,
  name: true,
  nameEn: true,
  color: true,
} as const;

/** Agents milestone — the owner agent badge/column on internal screens. */
export const STORE_ORDER_AGENT_SELECT = {
  select: { id: true, name: true, agentNumber: true },
} as const;

const ORDER_INCLUDE = {
  partner: true,
  agent: STORE_ORDER_AGENT_SELECT,
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
      paymentMethod: {
        select: { id: true, name: true, requiresReconciliation: true },
      },
      receiptLink: { select: { financialTransactionId: true } },
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
  agent: STORE_ORDER_AGENT_SELECT,
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
 * Round 5 Spec 1B — what a create path decided before persisting: the
 * namespaced client key (a retry returns the first order) and the enforced
 * duplicate check outcome (existing customer to reuse, review flag, timeline
 * row). Always server-derived, never a client field.
 */
export interface StoreOrderCreateOptions {
  creationIdempotencyKey?: string | null;
  /** `payloadFingerprint` of the request — a reused key with other data is refused. */
  creationPayloadHash?: string | null;
  duplicate?: DuplicateOutcome | null;
}

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
    private readonly productsService: ProductsService,
    private readonly inventoryService: InventoryService,
    private readonly fulfillmentCostService: FulfillmentCostService,
    private readonly storeOrderCollection: StoreOrderCollectionService,
    private readonly orderEconomicsService: OrderEconomicsService,
    private readonly accountMapping: AccountMappingService,
    /** Agents milestone — pickup handover hook (B2). Optional only so unit specs can omit it. */
    @Optional()
    private readonly agentFulfillment?: AgentFulfillmentService,
  ) {}

  /** The customer so far has agent orders only (no company order) — outside the company scope. */
  private async onlyAgentOrders(partnerId: string) {
    const [agentOrders, companyOrders] = await Promise.all([
      this.prisma.storeOrder.count({
        where: { partnerId, deletedAt: null, agentId: { not: null } },
      }),
      this.prisma.storeOrder.count({
        where: { partnerId, deletedAt: null, agentId: null },
      }),
    ]);
    return agentOrders > 0 && companyOrders === 0;
  }

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
  async create(
    dto: CreateStoreOrderDto,
    userId?: string,
    /** Optional in-transaction step (e.g. a payment declaration) — commits or rolls back with the order. */
    afterCreate?: (
      tx: Prisma.TransactionClient,
      storeOrderId: string,
    ) => Promise<unknown>,
    /**
     * Agents milestone — a validated, server-derived agent order from
     * `AgentOrdersService` (never a client field): owner agent, agreement
     * snapshot, price breakdown, lines and owner are taken from it.
     */
    agentOrder?: AgentOrderPersistInput,
    options: StoreOrderCreateOptions = {},
  ) {
    const creationKey = options.creationIdempotencyKey ?? null;
    const payloadHash = options.creationPayloadHash ?? null;
    const replay = await this.findCreationReplay(
      creationKey,
      agentOrder ? undefined : userId,
      payloadHash,
    );
    if (replay) return replay;
    if (agentOrder && (dto.externalOrderId || dto.payment)) {
      throw new BadRequestException(
        'Agent orders take no external order id or direct payment.',
      );
    }
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

    // Agent orders were validated by AgentOrdersService (owner, status,
    // sellable); the company-order check would reject agent-owned goods.
    if (!agentOrder) {
      await this.assertActiveProducts(dto.items.map((item) => item.productId));
    }

    // O3 — one phone number = one customer. A customer confirmed through
    // the duplicate check (phone match in or outside the caller's scope, or
    // "same customer" on a name match) is reused as-is; otherwise the
    // partner owning the phone is reused, or a new one created (race-safe).
    // Agent orders resolve inside the transaction and never update the
    // matched partner (the typed customer lives on the order snapshot).
    const confirmedPartnerId = options.duplicate?.partnerId ?? null;
    const partnerId = agentOrder
      ? null
      : confirmedPartnerId
        ? (
            await this.partnersService.useExistingWithRole(
              confirmedPartnerId,
              PartnerRoleType.CUSTOMER,
              userId,
            )
          ).id
        : (
            await this.partnersService.findOrCreateWithRole(
              { ...dto.partner, role: PartnerRoleType.CUSTOMER },
              userId,
            )
          ).partner.id;
    // A company order reusing a customer that so far only has agent orders
    // (paths without the interactive duplicate check, e.g. imports) is
    // flagged for internal duplicate review like a cross-scope match.
    const duplicate =
      options.duplicate ??
      (!agentOrder && partnerId && (await this.onlyAgentOrders(partnerId))
        ? CROSS_SCOPE_REUSE_OUTCOME(partnerId)
        : null);

    const internalOrderId =
      await this.numberingEngine.generateNumber('STORE_ORDER');

    const paymentType = dto.paymentType ?? StoreOrderPaymentType.PREPAID;
    const fulfillmentMethod =
      dto.fulfillmentMethod ?? StoreOrderFulfillmentMethod.SHIPPING;
    // Confirmed orders: shipping → Ready for Shipping; pickup → Awaiting Preparation.
    // Payment status never sets these.
    let shippingStage: StoreOrderShippingStage =
      fulfillmentMethod === StoreOrderFulfillmentMethod.PICKUP
        ? StoreOrderShippingStage.NOT_READY
        : StoreOrderShippingStage.READY_FOR_SHIPPING;
    let fulfillmentCode =
      fulfillmentMethod === StoreOrderFulfillmentMethod.PICKUP
        ? 'AWAITING_PREPARATION'
        : 'READY';
    if (agentOrder) {
      const stage = agentOrderInitialStage(agentOrder);
      shippingStage = stage.shippingStage;
      fulfillmentCode = stage.fulfillmentCode;
    }

    let employeeId = agentOrder ? agentOrder.employeeId : dto.employeeId;
    if (userId && !agentOrder) {
      const scope = await this.salesScope.resolve(userId);
      if (!employeeId) employeeId = userId;
      if (!this.salesScope.canSetOrderOwner(scope, employeeId)) {
        throw new ForbiddenException(
          'You are not allowed to assign this Store Order to that owner.',
        );
      }
    }
    // Owner affiliation (S4): company order → internal user; agent order →
    // active user of that agent (AgentOrdersService already resolved it).
    if (employeeId) {
      await assertOwnerAffiliation(
        this.prisma,
        agentOrder?.agentId ?? null,
        employeeId,
        STORE_ORDER_OWNER_ERRORS,
      );
    }

    try {
      const order = await this.prisma.$transaction(async (tx) => {
        const orderPartnerId =
          partnerId ??
          (await resolveAgentCustomerPartner(
            tx,
            {
              numbering: this.numberingEngine,
              phones: this.phoneNumberService,
            },
            agentOrder!.customer,
            userId,
            confirmedPartnerId,
          ));
        const created = await tx.storeOrder.create({
          data: {
            internalOrderId,
            externalOrderId: dto.externalOrderId,
            partnerId: orderPartnerId,
            orderDate: dto.orderDate ? new Date(dto.orderDate) : undefined,
            source: dto.source,
            sourceChannel: dto.sourceChannel,
            employeeId,
            currencyId: dto.currencyId,
            paymentType,
            fulfillmentMethod,
            shippingStage,
            paymentStatusId: this.statusResolver.paymentStatusId(
              StoreOrderPaymentStatus.PAYMENT_PENDING,
            ),
            fulfillmentStatusId:
              this.statusResolver.fulfillmentStatusIdByCode(fulfillmentCode),
            notes: dto.notes,
            createdBy: userId,
            updatedBy: userId,
            ...(agentOrder ? agentOrderColumns(agentOrder) : {}),
            ...duplicateOrderColumns(creationKey, duplicate, payloadHash),
            items: {
              create: agentOrder
                ? agentOrderItems(agentOrder)
                : dto.items.map((item) => ({
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
        if (agentOrder) {
          await this.logAgentOrderCreated(tx, created.id, agentOrder, userId);
        }
        await logDuplicateDecision(tx, created.id, duplicate, userId);

        if (dto.payment) {
          assertCanAcceptPayment(
            await computeStoreOrderSettlement(tx, created.id),
            dto.payment.amount,
          );
          await this.createPaymentRow(
            created.id,
            created.currencyId,
            dto.payment,
            userId,
            tx,
          );
        }

        if (afterCreate) await afterCreate(tx, created.id);

        // R6 SHIP hook — an eligible shipping order goes straight into the
        // internal Shipping queue (company and agent orders alike).
        await ensureShippingQueued(tx, created.id, { actorId: userId });

        return created;
      });

      if (dto.payment) {
        await this.paymentSync.recompute(order.id);
      }

      // Agent callers (portal) are outside the internal sales scope; the
      // agent orders service applies the agent visibility itself.
      return this.findOne(order.id, agentOrder ? undefined : userId);
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2003'
      ) {
        throw new BadRequestException(
          'Invalid product, employee, or currency reference.',
        );
      }
      // A concurrent submit with the same key won the unique column.
      if (
        creationKey &&
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        const concurrent = await this.findCreationReplay(
          creationKey,
          agentOrder ? undefined : userId,
          payloadHash,
        );
        if (concurrent) return concurrent;
      }
      throw error;
    }
  }

  /**
   * Spec 1B idempotent submission — the order already created with this
   * namespaced key (re-read through the caller's scope), flagged
   * `idempotentReplay: true`; null when the key is new. An archived order
   * (ORDER_KEY_ALREADY_USED) or a different payload (IDEMPOTENCY_KEY_REUSED)
   * is a 409.
   */
  async findCreationReplay(
    creationIdempotencyKey: string | null | undefined,
    userId?: string,
    payloadHash?: string | null,
  ) {
    if (!creationIdempotencyKey) return null;
    const existing = await this.prisma.storeOrder.findUnique({
      where: { creationIdempotencyKey },
      select: { id: true, deletedAt: true, creationPayloadHash: true },
    });
    if (!existing) return null;
    const orderId = assertReplayable(existing, payloadHash);
    return {
      ...(await this.findOne(orderId, userId)),
      idempotentReplay: true as const,
    };
  }

  /** Breakdown + audited shipping override on the order timeline (spec §5). */
  async logAgentOrderCreated(
    tx: Prisma.TransactionClient,
    storeOrderId: string,
    agentOrder: AgentOrderPersistInput,
    userId?: string,
  ) {
    await tx.storeOrderActivity.create({
      data: {
        storeOrderId,
        action: 'AGENT_ORDER_CREATED',
        details: agentOrderActivityDetails(agentOrder),
        performedById: userId ?? null,
      },
    });
    const override = agentShippingOverrideDetails(agentOrder);
    if (override) {
      await tx.storeOrderActivity.create({
        data: {
          storeOrderId,
          action: 'AGENT_SHIPPING_OVERRIDE',
          details: override,
          performedById: userId ?? null,
        },
      });
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

    await this.assertActiveProducts(dto.items.map((item) => item.productId));
    if (order.agentId) {
      throw new BadRequestException(
        'Agent orders are never updated from an import source.',
      );
    }
    if (dto.employeeId) {
      await assertOwnerAffiliation(
        this.prisma,
        null,
        dto.employeeId,
        STORE_ORDER_OWNER_ERRORS,
      );
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
            version: { increment: 1 },
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
        await recomputeDeclaredPaymentStatus(tx, id);
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

  private async buildFindWhere(
    query: Pick<
      FindStoreOrdersQueryDto,
      | 'partnerId'
      | 'phone'
      | 'paymentStatus'
      | 'declaredPaymentStatus'
      | 'shippingStage'
      | 'source'
      | 'search'
      | 'dateFrom'
      | 'dateTo'
      | 'agentId'
      | 'duplicateReviewStatus'
    >,
  ): Promise<Prisma.StoreOrderWhereInput> {
    const where: Prisma.StoreOrderWhereInput = {
      deletedAt: null,
      partnerId: query.partnerId,
      agentId: query.agentId,
      duplicateReviewStatus: query.duplicateReviewStatus,
      paymentStatus: prismaEnumFilter(query.paymentStatus),
      declaredPaymentStatus: prismaEnumFilter(query.declaredPaymentStatus),
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
      const or: Prisma.StoreOrderWhereInput[] = [
        { internalOrderId: { contains: search, mode: 'insensitive' } },
        { externalOrderId: { contains: search, mode: 'insensitive' } },
        { partner: { name: { contains: search, mode: 'insensitive' } } },
        ...phoneCandidates.flatMap((digits) => [
          { partner: { phone: { contains: digits } } },
          { partner: { mobile: { contains: digits } } },
        ]),
      ];
      // Arabic-normalized customer name ("أحمد" finds "احمد") — one more OR
      // branch; the sales scope is still AND-ed on in buildScopedFindWhere.
      const partnerIds = await findArabicNormalizedIds(
        this.prisma,
        CUSTOMER_NAME_NORMALIZED_SEARCH,
        search,
      );
      if (partnerIds?.length) or.push({ partnerId: { in: partnerIds } });
      where.OR = or;
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
    const where = await this.buildFindWhere(query);
    if (!userId) return where;
    const scope = await this.salesScope.resolve(userId);
    return { AND: [where, this.salesScope.storeOrderWhere(scope)] };
  }

  /**
   * ADR-0018 (M2 gap closure, Part 15-22) — `includeProfitability` is the
   * SERVER's already-permission-checked decision (`StoreOrdersController`
   * resolves it from `orders.profitability.view`, never trusts the raw
   * query param), never re-derived here. `query.costState`/`lossMaking`
   * are only honored when it's true — a caller without the permission can
   * never use them as an oracle into profitability data it can't see.
   */
  async findAll(
    query: FindStoreOrdersQueryDto,
    userId?: string,
    includeProfitability = false,
  ) {
    const where = await this.buildScopedFindWhere(query, userId);
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 20;
    const orderBy = this.buildFindOrderBy(query);

    if (this.usesProfitabilityFilter(query, includeProfitability)) {
      return this.findAllFilteredByProfitability(
        where,
        orderBy,
        page,
        pageSize,
        query,
      );
    }

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
    const mapped = await Promise.all(
      items.map((item) => this.attachCurrentShippingStatus(item)),
    );

    // One batched query for however many rows are on this page — never a
    // per-row `getForStoreOrder` call (Part 17: no N+1).
    const economicsById = includeProfitability
      ? await this.orderEconomicsService.getSummaryForOrders(
          mapped.map((item) => item.id),
        )
      : null;

    return {
      items: economicsById
        ? mapped.map((item) => ({
            ...item,
            profitability: economicsById.get(item.id) ?? null,
          }))
        : mapped,
      total,
      page,
      pageSize,
    };
  }

  /**
   * Cost State / Loss-Making filtering has no materialized/denormalized
   * column to filter on in SQL — both depend on the full Order Economics
   * computation. Rather than compute it for every Order in the database,
   * this bounds the candidate set to the first `PROFITABILITY_FILTER_CAP`
   * matching rows (by the caller's own filters/sort) and filters/paginates
   * within that bounded set. `profitabilityFilterCapped: true` tells the
   * caller the result may be incomplete so it can prompt for a narrower
   * filter — never presented as a silently-wrong total. An unbounded
   * version would need a materialized summary table with its own write-
   * path invalidation; out of scope for this pass (see ADR-0018 M2 gap
   * closure report, Part 19/20).
   */
  private readonly PROFITABILITY_FILTER_CAP = 500;

  /** Same list order for `findAll` and `findAllIds` (stable `id` tiebreak). */
  private buildFindOrderBy(
    query: Pick<FindStoreOrdersQueryDto, 'sortBy' | 'sortOrder'>,
  ): Prisma.StoreOrderOrderByWithRelationInput[] {
    const sortField = query.sortBy || 'createdAt';
    const sortDir = query.sortOrder ?? 'desc';
    return sortField === 'id'
      ? [{ id: sortDir }]
      : [{ [sortField]: sortDir }, { id: 'desc' as const }];
  }

  /** Cost State / Loss-Making filters apply only for a caller already authorized for profitability. */
  private usesProfitabilityFilter(
    query: Pick<FindStoreOrdersQueryDto, 'costState' | 'lossMaking'>,
    includeProfitability: boolean,
  ): boolean {
    return (
      includeProfitability &&
      ((query.costState?.length ?? 0) > 0 || !!query.lossMaking)
    );
  }

  /**
   * The ONE Cost State / Loss-Making filter — shared by the list
   * (`findAllFilteredByProfitability`) and "select all matching"
   * (`findAllIds`), so both always describe the same set: the first
   * `PROFITABILITY_FILTER_CAP` candidates by the caller's filters/sort,
   * narrowed by Order Economics. `capped` = the candidate window was full,
   * so the result may be incomplete.
   */
  private async profitabilityFilteredIds(
    where: Prisma.StoreOrderWhereInput,
    orderBy: Prisma.StoreOrderOrderByWithRelationInput[],
    query: Pick<FindStoreOrdersQueryDto, 'costState' | 'lossMaking'>,
  ) {
    const candidates = await this.prisma.storeOrder.findMany({
      where,
      orderBy,
      take: this.PROFITABILITY_FILTER_CAP,
      select: { id: true },
    });
    const economicsById = await this.orderEconomicsService.getSummaryForOrders(
      candidates.map((c) => c.id),
    );
    const filteredIds = candidates
      .map((c) => c.id)
      .filter((id) => {
        const economics = economicsById.get(id);
        if (!economics) return false;
        if (
          query.costState?.length &&
          !query.costState.includes(economics.costState)
        ) {
          return false;
        }
        if (query.lossMaking && !(economics.contributionProfit < 0)) {
          return false;
        }
        return true;
      });
    return {
      filteredIds,
      economicsById,
      capped: candidates.length >= this.PROFITABILITY_FILTER_CAP,
    };
  }

  private async findAllFilteredByProfitability(
    where: Prisma.StoreOrderWhereInput,
    orderBy: Prisma.StoreOrderOrderByWithRelationInput[],
    page: number,
    pageSize: number,
    query: FindStoreOrdersQueryDto,
  ) {
    const { filteredIds, economicsById, capped } =
      await this.profitabilityFilteredIds(where, orderBy, query);

    const total = filteredIds.length;
    const pageIds = filteredIds.slice((page - 1) * pageSize, page * pageSize);
    const rows = pageIds.length
      ? await this.prisma.storeOrder.findMany({
          where: { id: { in: pageIds } },
          include: ORDER_LIST_INCLUDE,
        })
      : [];
    const rowsById = new Map(rows.map((row) => [row.id, row]));
    const orderedRows = pageIds
      .map((id) => rowsById.get(id))
      .filter((row): row is NonNullable<typeof row> => row != null);
    const mapped = await Promise.all(
      orderedRows.map((item) => this.attachCurrentShippingStatus(item)),
    );

    return {
      items: mapped.map((item) => ({
        ...item,
        profitability: economicsById.get(item.id) ?? null,
      })),
      total,
      page,
      pageSize,
      profitabilityFilterCapped: capped,
    };
  }

  /**
   * "Select all matching filters" / "select the first N" — bare IDs only,
   * same filter/search as `findAll`, ordered the same way (`sortBy`/
   * `sortOrder`) so a caller-supplied `limit` deterministically means "the
   * first N by the current sort," never an arbitrary DB-order subset.
   * Uncapped selection still stops at `BULK_LIMITS.selectIdsMax` rows —
   * plain id strings, not full records — and `total` is always the full
   * match count, so a caller can tell a truncated selection from "all".
   *
   * Cost State / Loss-Making: applied exactly as `findAll` applies them
   * (same `includeProfitability` gate, same bounded filter), so "select all"
   * under a loss-making filter selects only the loss-making orders the list
   * shows. `profitabilityFilterCapped` is passed through, as in `findAll`.
   */
  async findAllIds(
    query: Pick<
      FindStoreOrdersQueryDto,
      | 'partnerId'
      | 'phone'
      | 'paymentStatus'
      | 'declaredPaymentStatus'
      | 'shippingStage'
      | 'source'
      | 'search'
      | 'dateFrom'
      | 'dateTo'
      | 'agentId'
      | 'duplicateReviewStatus'
      | 'sortBy'
      | 'sortOrder'
      | 'limit'
      | 'costState'
      | 'lossMaking'
    >,
    userId?: string,
    includeProfitability = false,
  ): Promise<{
    ids: string[];
    total: number;
    profitabilityFilterCapped?: boolean;
  }> {
    const where = await this.buildScopedFindWhere(query, userId);
    const orderBy = this.buildFindOrderBy(query);
    const take = Math.min(
      query.limit ?? BULK_LIMITS.selectIdsMax,
      BULK_LIMITS.selectIdsMax,
    );

    if (this.usesProfitabilityFilter(query, includeProfitability)) {
      const { filteredIds, capped } = await this.profitabilityFilteredIds(
        where,
        orderBy,
        query,
      );
      return {
        ids: filteredIds.slice(0, take),
        total: filteredIds.length,
        profitabilityFilterCapped: capped,
      };
    }

    const [rows, total] = await Promise.all([
      this.prisma.storeOrder.findMany({
        where,
        select: { id: true },
        orderBy,
        take,
      }),
      this.prisma.storeOrder.count({ where }),
    ]);
    return { ids: rows.map((row) => row.id), total };
  }

  /**
   * Exact Order Number global lookup — gated by `orders.lookup_global`, NOT
   * `store-orders.manage`. Deliberately bypasses `SalesScopeService`'s
   * own-scope restriction (that is the entire point of a targeted global
   * lookup) but returns a safe, read-only DTO only: no payments, no
   * receipts, no owner identity, no financial evidence. Every call — match
   * or not — is written to `GlobalLookupAudit`.
   */
  async globalLookupByOrderNumber(orderNumber: string, userId: string) {
    const order = await this.prisma.storeOrder.findFirst({
      where: {
        deletedAt: null,
        OR: [
          { internalOrderId: orderNumber },
          { externalOrderId: orderNumber },
        ],
      },
      include: {
        partner: {
          select: { id: true, name: true, phone: true, mobile: true },
        },
        items: { include: { product: true }, take: 5 },
        shipments: { orderBy: { attemptNumber: 'desc' }, take: 1 },
      },
    });

    await this.prisma.globalLookupAudit.create({
      data: {
        userId,
        action: 'GLOBAL_ORDER_LOOKUP',
        method: 'ORDER_NUMBER',
        queryValue: orderNumber,
        matchedStoreOrderId: order?.id,
      },
    });

    if (!order) return null;

    return {
      id: order.id,
      orderNumber: order.internalOrderId,
      orderDate: order.orderDate,
      customerName: order.partner.name,
      customerPhone: order.partner.phone || order.partner.mobile,
      products: order.items
        .map((item) => item.product.displayName || item.product.name)
        .join(' · '),
      paymentStatus: order.paymentStatus,
      shippingStage: order.shippingStage,
      shippingStatus: order.shipments[0]?.status ?? null,
    };
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
      payableTotal?: Prisma.Decimal | null;
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
    const total = storeOrderPayableTotal(order);
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
    const current = await this.findOne(id, userId);
    if (dto.employeeId) {
      await assertOwnerAffiliation(
        this.prisma,
        current.agentId ?? null,
        dto.employeeId,
        STORE_ORDER_OWNER_ERRORS,
      );
    }
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

  /**
   * Business operation: Correct Agreed Amounts. The only way to price a
   * Store Order after creation, and only while nothing has been settled or
   * invoiced against the current price — no confirmed Sales Invoice and no
   * verified payment. Amounts are entered by the user (never derived from a
   * catalogue price) and every change is written to the order timeline.
   */
  async setLineAmounts(
    id: string,
    dto: SetStoreOrderLineAmountsDto,
    userId?: string,
  ) {
    await this.findOne(id, userId);
    await this.prisma.$transaction(async (tx) => {
      await lockStoreOrderRow(tx, id);
      const order = await tx.storeOrder.findFirstOrThrow({
        where: { id, deletedAt: null },
        include: {
          items: {
            where: { deletedAt: null },
            include: { product: { select: { name: true } } },
          },
          invoices: {
            where: {
              deletedAt: null,
              status: { not: SalesDocumentStatus.CANCELLED },
            },
            select: { invoiceNumber: true },
          },
          payments: {
            where: { deletedAt: null, status: PaymentStatus.VERIFIED },
            select: { paymentNumber: true },
          },
        },
      });
      // Agent orders carry a snapshotted price breakdown (spec §5); editing
      // single lines would desynchronize merchandise / payable total.
      if (order.agentId) {
        throw agentUnprocessable(
          'AGENT_ORDER_PRICING_LOCKED',
          'تسعير طلب الوكيل ثابت بعد الإنشاء',
          'An agent order keeps the price breakdown it was submitted with; its line amounts cannot be corrected here.',
        );
      }
      if (order.invoices.length > 0) {
        throw new BadRequestException(
          `Store Order ${order.internalOrderId} is already invoiced (${order.invoices.map((i) => i.invoiceNumber).join(', ')}) — its prices can no longer change.`,
        );
      }
      if (order.payments.length > 0) {
        throw new BadRequestException(
          `Store Order ${order.internalOrderId} already has verified payments (${order.payments.map((p) => p.paymentNumber).join(', ')}) — its prices can no longer change.`,
        );
      }
      const itemsById = new Map(order.items.map((item) => [item.id, item]));
      const nextAmounts = new Map(
        order.items.map((item) => [item.id, storeOrderLineAmount(item)]),
      );
      for (const line of dto.items) {
        if (!itemsById.has(line.itemId)) {
          throw new BadRequestException(
            `Line ${line.itemId} does not belong to Store Order ${order.internalOrderId}.`,
          );
        }
        nextAmounts.set(line.itemId, line.agreedAmount);
      }
      const nextTotal = [...nextAmounts.values()].reduce((a, b) => a + b, 0);
      if (nextTotal <= 0.005) {
        throw new BadRequestException(
          'The order total must be greater than 0.00 — enter the agreed amount for at least one line.',
        );
      }

      // Standing claims (PENDING / MATCHED / VERIFIED) are money the
      // customer is reported to have paid — the total may never drop below
      // them. Raising it simply re-opens the declared remainder (PAID →
      // PARTIALLY_PAID, closing the prepaid gate); no claim is ever created.
      const standing = await standingClaimsTotal(tx, id);
      if (nextTotal + 0.005 < standing) {
        throw new ConflictException(
          `The new order total ${nextTotal.toFixed(2)} is below the ${standing.toFixed(2)} already declared as paid by the customer. Ask Finance to reject or dispute the excess claim first, then correct the amounts.`,
        );
      }

      const changes: string[] = [];
      for (const line of dto.items) {
        const item = itemsById.get(line.itemId)!;
        const before = storeOrderLineAmount(item);
        if (Math.abs(before - line.agreedAmount) < 0.005) continue;
        await tx.storeOrderItem.update({
          where: { id: item.id },
          data: {
            agreedAmount: line.agreedAmount,
            unitPrice: derivedUnitPrice(item.quantity, line.agreedAmount),
          },
        });
        changes.push(
          `${item.product?.name ?? item.productId}: ${before.toFixed(2)} → ${line.agreedAmount.toFixed(2)}`,
        );
      }
      if (changes.length === 0) return;
      await tx.storeOrder.update({
        where: { id },
        // Spec 1A — commercial data changed: stale amendment previews conflict.
        data: { updatedBy: userId, version: { increment: 1 } },
      });
      await recomputeDeclaredPaymentStatus(tx, id);
      await this.activityService.log(
        id,
        StoreOrderActivityType.ORDER_UPDATED,
        `Agreed amounts corrected — ${changes.join('; ')}`,
        userId,
        tx,
      );
    });
    await this.paymentSync.recompute(id);
    return this.findOne(id, userId);
  }

  /** Business operation: Archive. Soft-delete only — schema has no hard delete anywhere in this pipeline. */
  async archive(id: string, userId?: string) {
    await this.findOne(id, userId);
    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.storeOrder.update({
        where: { id },
        data: { deletedAt: new Date(), updatedBy: userId },
      });
      // R6 SHIP hook — an archived order leaves the Shipping queue when no
      // one has worked on its attempt yet (worked attempts are kept).
      await ensureShippingQueued(tx, id, { actorId: userId });
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
    const payment = await this.prisma.$transaction(async (tx) => {
      await lockStoreOrderRow(tx, id);
      const order = await tx.storeOrder.findFirst({
        where: { id, deletedAt: null },
        include: {
          items: {
            select: { quantity: true, unitPrice: true, agreedAmount: true },
          },
        },
      });
      if (!order) {
        throw new NotFoundException(`Store Order ${id} not found`);
      }
      assertNotAgentOrderPayment(order.agentId);
      const settlement = await computeStoreOrderSettlement(tx, id);
      assertCanAcceptPayment(settlement, dto.amount);
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
    assertNotAgentOrderPayment(order.agentId);
    const settlement = await computeStoreOrderSettlement(this.prisma, id);
    assertCanAcceptPayment(settlement, dto.reportedAmount);

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
      await lockStoreOrderRow(tx, id);
      const lockedSettlement = await computeStoreOrderSettlement(tx, id);
      assertCanAcceptPayment(lockedSettlement, dto.reportedAmount);
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
   * R6 SHIP — is this order in the internal Shipping queue, and if not, why
   * (archived, cancelled, pickup, nothing to ship, prepaid awaiting payment).
   */
  async shippingHandoff(id: string, userId?: string) {
    await this.findOne(id, userId);
    return readShippingHandoff(this.prisma, id);
  }

  /**
   * Central fulfillment gate — see `evaluateFulfillmentGate`: PREPAID needs a
   * full paid declaration OR verified payment; COD may ship before payment.
   */
  async canFulfill(id: string) {
    const order = await this.findOne(id);
    return evaluateFulfillmentGate({
      paymentType: order.paymentType,
      declaredPaymentStatus: order.declaredPaymentStatus,
      paymentStatus: order.paymentStatus,
      paymentStatusCode: order.paymentStatusDef?.code ?? null,
    });
  }

  /**
   * Pickup workflow transitions. Never creates shipment/label rows.
   * Allowed codes: AWAITING_PREPARATION → READY_FOR_PICKUP → COLLECTED
   * (+ CANCELLED / RETURNED where applicable via fulfillment StatusDefinition).
   */
  async transitionPickup(
    id: string,
    code: 'READY_FOR_PICKUP' | 'COLLECTED' | 'CANCELLED' | 'RETURNED',
    userId?: string,
  ) {
    const order = await this.findOne(id, userId);
    if (order.fulfillmentMethod !== StoreOrderFulfillmentMethod.PICKUP) {
      throw new BadRequestException(
        'Only pickup orders use the pickup workflow.',
      );
    }
    const allowedFrom: Record<string, string[]> = {
      READY_FOR_PICKUP: ['AWAITING_PREPARATION'],
      COLLECTED: ['READY_FOR_PICKUP'],
      CANCELLED: ['AWAITING_PREPARATION', 'READY_FOR_PICKUP'],
      RETURNED: ['COLLECTED'],
    };
    // F-L5: an agent order's goods come back only through an agent return
    // receipt (stock, return fee and commission reversal in one place).
    if (code === 'RETURNED' && order.agentId) {
      throw agentUnprocessable(
        'AGENT_ORDER_USE_RETURN_RECEIPT',
        'مرتجعات طلبات الوكلاء تُسجَّل من "استلام مرتجع الوكيل" وليس من حالة الاستلام',
        'Agent orders are returned through the agent return receipt (Shipping → agent return), not the pickup RETURNED status.',
      );
    }
    const current = order.fulfillmentStatus?.code ?? 'AWAITING_PREPARATION';
    if (!allowedFrom[code]?.includes(current)) {
      throw new BadRequestException(
        `Cannot move pickup from ${current} to ${code}.`,
      );
    }
    // Prepaid pickup readiness and collection need the same payment basis as
    // shipping (declared PAID in full or verified paid); COD is never gated.
    // Nothing here is automatic — an authorized user records each step.
    if (code === 'READY_FOR_PICKUP' || code === 'COLLECTED') {
      const gate = await this.canFulfill(id);
      if (!gate.allowed) {
        throw new BadRequestException(gate.reason ?? 'Payment required.');
      }
    }
    // Agents milestone (spec §6.4): handover issues the agent's stock and is
    // the DELIVERED earning event — idempotent, before the status moves.
    if (code === 'COLLECTED' && order.agentId) {
      if (!this.agentFulfillment) {
        throw new Error('Agent fulfillment hooks are not available.');
      }
      await this.agentFulfillment.onPickupHandover(id, userId);
    }
    const statusId = this.statusResolver.fulfillmentStatusIdByCode(code);
    await this.prisma.storeOrder.update({
      where: { id },
      data: {
        fulfillmentStatusId: statusId,
        shippingStage: StoreOrderShippingStage.NOT_READY,
        updatedBy: userId ?? null,
      },
    });
    await this.activityService.log(
      id,
      StoreOrderActivityType.SHIPPING_STAGE_CHANGED,
      `Pickup status → ${code}`,
      userId,
    );
    return this.findOne(id, userId);
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
    assertPaymentCurrency(orderCurrencyId, dto.currencyId);
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

  private resolvePaymentSourceId(
    dto: { paymentSourceId?: string; paymentMethodId?: string },
    tx: Prisma.TransactionClient,
  ): Promise<string> {
    return resolvePaymentSourceId(tx, dto);
  }

  /**
   * Outstanding uses verified/reconciled payments only — pending claims
   * do not reduce what Finance still needs to confirm.
   */
  async paymentContext(id: string, userId?: string) {
    await this.findOne(id, userId);
    const settlement = await computeStoreOrderSettlement(this.prisma, id);
    return {
      ...serializeSettlement(settlement),
      currencyId: (await this.prisma.storeOrder.findFirst({
        where: { id },
        select: { currencyId: true },
      }))!.currencyId,
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
    // Agents milestone (spec §6.4): agent-owned merchandise is not company
    // revenue — no company sales invoice, COGS or stock issue via this path
    // (agent stock is issued at dispatch by the agent finance hooks).
    if (order.agentId) {
      throw agentUnprocessable(
        'AGENT_ORDER_NO_COMPANY_INVOICE',
        'طلبات الوكلاء لا يصدر لها فاتورة مبيعات للشركة لأن البضاعة ملك الوكيل',
        'Agent orders cannot generate a company sales invoice — the merchandise belongs to the agent.',
      );
    }
    // Defensive (S2): even a company order never invoices agent-owned goods
    // (checked on the loaded lines — the owner locks once a line exists).
    for (const item of order.items) assertCompanyOwnedProduct(item.product);
    if (order.paymentStatus !== StoreOrderPaymentStatus.FULLY_PAID_RECONCILED) {
      throw new BadRequestException(
        'Invoice can only be generated once the order is Fully Paid & Reconciled.',
      );
    }
    // A cancelled (never posted) invoice — e.g. cancelled by an order
    // amendment — does not block issuing the corrected one.
    const existingInvoice = await this.prisma.salesInvoice.findFirst({
      where: {
        storeOrderId: id,
        deletedAt: null,
        status: { not: SalesDocumentStatus.CANCELLED },
      },
    });
    if (existingInvoice) {
      throw new BadRequestException({
        code: 'DUPLICATE',
        message: `Store Order ${order.internalOrderId} already has an invoice (${existingInvoice.invoiceNumber}).`,
        fields: [],
      });
    }

    // Default warehouse resolution (rule 7) — shared with agent dispatch.
    const resolvedWarehouseIds = await resolveStoreOrderLineWarehouses(
      this.prisma,
      order.items,
    );

    const taxIds = order.items.map((item) => item.product.taxId);
    const taxById = await resolveTaxesById(this.prisma, taxIds);
    const computedLines = order.items.map((item) => {
      const tax = item.product.taxId
        ? taxById.get(item.product.taxId)
        : undefined;
      return computeSalesLine({
        quantity: item.quantity,
        unitPrice: Number(item.unitPrice),
        agreedAmount: storeOrderLineAmount(item),
        taxRatePercent: tax?.rate,
        taxInclusive: tax?.inclusive,
      });
    });
    const totals = computeSalesDocumentTotals(computedLines);

    const invoiceNumber =
      await this.numberingEngine.generateNumber('SALES_INVOICE');

    const fulfillmentRule =
      await this.prisma.directFulfillmentCostRule.findFirst({
        where: {
          deletedAt: null,
          isActive: true,
        },
        select: { id: true },
      });
    await this.accountMapping.assertSalesInvoiceMappings({
      partnerId: order.partnerId,
      items: order.items.map((item, index) => ({
        categoryId: item.product.categoryId,
        isInventoryItem: item.product.isInventoryItem,
        sku: item.product.sku,
        currentCost: item.product.currentCost,
        taxId: item.product.taxId,
        taxAmount: computedLines[index].taxAmount,
      })),
      includeFulfillment: Boolean(fulfillmentRule),
    });

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
              warehouseId: resolvedWarehouseIds[index],
              unitId: item.product.unitId,
              quantity: item.quantity,
              unitPrice: item.unitPrice,
              taxId: item.product.taxId,
              taxAmount: computedLines[index].taxAmount,
              lineTotal: computedLines[index].lineTotal,
            })),
          },
        },
      });

      // Fix (M1 recovery): this used to only post the accounting/valuation
      // side (Dr COGS / Cr Inventory via SalesInvoicePostingProvider) and
      // never actually decremented physical stock — unlike the symmetric
      // B2B `SalesInvoicesService.confirm()`, which always calls both. Every
      // Store Order invoice generated before this fix left the GL Inventory
      // balance and the real on-hand quantity silently diverging. Mirrored
      // here exactly, guarded to inventory-item products only (a Store
      // Order can legitimately contain non-stocked/service products, which
      // `postSalesDelivery` would otherwise reject).
      for (const [index, item] of order.items.entries()) {
        if (!item.product.isInventoryItem) continue;
        await this.inventoryService.postSalesDelivery(
          {
            productId: item.productId,
            warehouseId: resolvedWarehouseIds[index],
            quantity: item.quantity,
            referenceType: 'SALES_INVOICE',
            referenceId: created.id,
          },
          userId,
          tx,
        );
      }

      // ADR-0018 (Order Economics M2.2) — the same recognition moment as
      // historical COGS above: apply the immutable Fulfillment Cost snapshot
      // before posting, so a later rate change can never alter this Order's
      // recorded profitability.
      await this.fulfillmentCostService.applyStandardCost(id, tx, userId);

      await this.postingEngine.post('SALES_INVOICE', created.id, userId, tx);
      await this.postingEngine.post('FULFILLMENT_COST', id, userId, tx);

      await this.activityService.log(
        id,
        StoreOrderActivityType.INVOICE_GENERATED,
        `Sales Invoice ${created.invoiceNumber} generated`,
        userId,
        tx,
      );

      return created;
    });

    try {
      await this.storeOrderCollection.syncVerifiedPayments(id, userId);
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : 'Customer receipt posting failed.';
      throw new BadRequestException(
        `Sales Invoice ${invoice.invoiceNumber} was created, but customer receipt posting failed: ${message}. Open the invoice and retry the receipt — do not generate the invoice again.`,
      );
    }

    return invoice;
  }

  /**
   * Batched replacement for a former per-line `findFirst` loop — one query
   * for every product id on the order instead of one query per line item.
   * Same error type/message as before (a per-order-item `BadRequestException`),
   * just backed by `ProductsService.findManyForValidation`'s single query.
   */
  private async assertActiveProducts(productIds: string[]) {
    const uniqueIds = [...new Set(productIds)];
    if (uniqueIds.length === 0) return;
    const productsById =
      await this.productsService.findManyForValidation(uniqueIds);
    for (const id of uniqueIds) {
      const product = productsById.get(id);
      if (!product || product.status !== ProductStatus.ACTIVE) {
        throw new BadRequestException(
          `Product ${id} not found or is not active.`,
        );
      }
      // Agents milestone (spec §4, S2): agent-owned goods are sold only
      // through an agent order (server-derived agent, agreement and pricing).
      assertCompanyOwnedProduct(product);
    }
  }
}
