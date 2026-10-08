import { BadRequestException, Injectable } from '@nestjs/common';
import { StoreOrderSource } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { SalesScopeService } from '../../sales-scope/sales-scope.service';
import { StoreOrdersService } from '../../store-orders/store-orders.service';
import { StoreOrderDuplicatesService } from '../../store-orders/duplicates/store-order-duplicates.service';
import { StoreOrderPaymentDeclarationService } from '../../store-orders/payment-declaration/store-order-payment-declaration.service';
import { resolvePaymentType } from '../../store-orders/payment-type.catalog';
import { REPEAT_CUSTOMER_ORDER_LABEL } from '../sync/store-orders-sync.lifecycle';
import { ReferenceDataRegistryService } from '../reference-data/reference-data-registry.service';
import type { ImportActor, ImportRowResult } from '../import-type.interface';
import { ImportOwnerService } from './import-owner.service';
import {
  createdOrderResult,
  findImportedOrder,
  ImportedOrderService,
} from './imported-order.service';
import { declarationKindFor, type ImportedOrderRows } from './store-order-rows';
import { companyOrderImportKey } from './import-row-key';
import {
  duplicateNeedsReview,
  repeatOrderResolution,
} from './import-duplicate-review';

/**
 * R15 (spec §3) — a company user's one-time store-order import row (group),
 * with the manual-entry rules: `StoreOrdersService.create` behind the same
 * duplicate gate as the create endpoint (`StoreOrderDuplicatesService.enforce`
 * — a phone match needs "Repeat customer = yes" or a confirmed review row;
 * several records on one number always need a person), the importer as owner
 * unless they may assign, company-owned active sellable products, explicit
 * prices, and a stated paid amount recorded as a PENDING declaration through
 * the declaration core — never a verified payment, receipt or journal entry.
 * The row key is the order's `creationIdempotencyKey`, so a retry is skipped.
 */
@Injectable()
export class CompanyStoreOrderImportService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storeOrders: StoreOrdersService,
    private readonly duplicates: StoreOrderDuplicatesService,
    private readonly declarations: StoreOrderPaymentDeclarationService,
    private readonly referenceData: ReferenceDataRegistryService,
    private readonly orders: ImportedOrderService,
    private readonly owners: ImportOwnerService,
    private readonly salesScope: SalesScopeService,
  ) {}

  async importGroup(
    rows: Record<string, string>[],
    actor: ImportActor,
    mode: { dryRun?: boolean; confirmed?: boolean },
  ): Promise<ImportRowResult> {
    const order = await this.orders.prepare(rows, actor);
    const { parsed, countryId, phone, products, currencyId, hash } = order;
    const { first } = parsed;
    const creationIdempotencyKey = companyOrderImportKey(hash);
    const imported =
      (await findImportedOrder(this.prisma, creationIdempotencyKey)) ??
      (await this.findByExternalId(parsed.externalOrderId, actor));
    if (imported) return imported;

    const employeeId = await this.owners.resolve(
      first.agentEmail,
      actor,
      'ORDER',
    );
    const declaration = await this.declarationFor(parsed, actor, currencyId);

    let duplicate: Awaited<ReturnType<StoreOrderDuplicatesService['enforce']>>;
    try {
      duplicate = await this.duplicates.enforce(
        { phones: [phone], name: first.customerName, countryId },
        { kind: 'COMPANY', userId: actor.userId },
        repeatOrderResolution(parsed.repeatCustomer || !!mode.confirmed),
      );
    } catch (error) {
      throw duplicateNeedsReview(error);
    }

    if (mode.dryRun) {
      const warnings = await this.orders.stockWarnings(order);
      return { id: 'dry-run', ...(warnings.length ? { warnings } : {}) };
    }

    let created: Awaited<ReturnType<StoreOrdersService['create']>>;
    try {
      created = await this.storeOrders.create(
        {
          externalOrderId: parsed.externalOrderId ?? undefined,
          partner: {
            name: first.customerName.trim(),
            phone,
            countryId,
            address: first.address?.trim() || undefined,
          },
          delivery: {
            countryId,
            city: first.city?.trim() || undefined,
            address: first.address?.trim() || undefined,
          },
          orderDate: parsed.orderDate,
          source: StoreOrderSource.IMPORT,
          // An acknowledged phone match is a deliberate repeat order (O3).
          sourceChannel: duplicate.partnerId
            ? REPEAT_CUSTOMER_ORDER_LABEL
            : undefined,
          currencyId,
          employeeId,
          paymentType: resolvePaymentType(first.paymentType) ?? undefined,
          notes: first.notes?.trim() || undefined,
          items: parsed.lines.map((line, index) => ({
            productId: products[index].id,
            quantity: line.quantity,
            unitPrice: line.lineAmount / line.quantity,
          })),
        },
        actor.userId,
        declaration
          ? (tx, orderId) =>
              this.declarations.declareInTx(
                tx,
                orderId,
                declaration.fields,
                `import:${hash}`,
                declaration.actor,
              )
          : undefined,
        undefined,
        { creationIdempotencyKey, creationPayloadHash: hash, duplicate },
      );
    } catch (error) {
      // Committed, but the read-back failed: this importer's own order (an
      // importer outside the order's read scope) is created; another
      // importer's concurrent commit of the same row is skipped.
      const committed = await this.prisma.storeOrder.findUnique({
        where: { creationIdempotencyKey },
        select: { id: true, createdBy: true, deletedAt: true },
      });
      if (!committed || committed.deletedAt) throw error;
      return committed.createdBy === actor.userId
        ? createdOrderResult(this.prisma, committed.id)
        : (await findImportedOrder(this.prisma, creationIdempotencyKey))!;
    }
    if ('idempotentReplay' in created) {
      return (await findImportedOrder(this.prisma, creationIdempotencyKey))!;
    }
    return createdOrderResult(this.prisma, created.id);
  }

  /**
   * A stated Paid Amount → the declaration (kind against the order total,
   * payment method required unless unpaid) and the importer's declaration
   * authority (same any-of permission as manual entry). Null = no column.
   */
  private async declarationFor(
    parsed: ImportedOrderRows,
    actor: ImportActor,
    currencyId: string,
  ) {
    if (parsed.paidAmount === null) return null;
    const total = parsed.lines.reduce((sum, line) => sum + line.lineAmount, 0);
    const { kind, amount } = declarationKindFor(parsed.paidAmount, total);
    const paymentMethodId =
      kind === 'UNPAID'
        ? undefined
        : await this.referenceData.resolveOptional(
            'PAYMENT_METHOD',
            'name',
            parsed.first.paymentMethodLabel,
            'Payment Method',
          );
    if (kind !== 'UNPAID' && !paymentMethodId) {
      throw new BadRequestException(
        'طريقة الدفع مطلوبة عند وجود مبلغ مدفوع — Payment Method is required when a Paid Amount is given.',
      );
    }
    return {
      actor: await this.declarations.resolveActor(actor.userId),
      fields: {
        kind,
        amount,
        paymentMethodId,
        currencyId,
        paymentDate: kind === 'UNPAID' ? undefined : parsed.paymentDate,
      },
    };
  }

  /**
   * The same external order id already in OMS — skipped. The existing order
   * is named only when the importer may open it (R15 review L3: an agent's or
   * another owner's order number is never disclosed).
   */
  private async findByExternalId(
    externalOrderId: string | null,
    actor: ImportActor,
  ): Promise<ImportRowResult | null> {
    if (!externalOrderId) return null;
    const existing = await this.prisma.storeOrder.findFirst({
      where: {
        externalOrderId: { equals: externalOrderId, mode: 'insensitive' },
        deletedAt: null,
      },
      select: { id: true, internalOrderId: true },
    });
    if (!existing) return null;
    const scope = await this.salesScope.resolve(actor.userId);
    const visible =
      (await this.prisma.storeOrder.count({
        where: {
          AND: [
            { id: existing.id },
            this.salesScope.storeOrderAccessWhere(scope),
          ],
        },
      })) > 0;
    return {
      id: existing.id,
      skipped: visible
        ? `رقم الطلب الخارجي «${externalOrderId}» موجود في الطلب ${existing.internalOrderId} — External order id "${externalOrderId}" already exists (${existing.internalOrderId}).`
        : `رقم الطلب الخارجي «${externalOrderId}» مستخدم مسبقًا — External order id "${externalOrderId}" already exists.`,
    };
  }
}
