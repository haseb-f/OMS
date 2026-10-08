import { BadRequestException, Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { PermissionsResolverService } from '../../permissions/permissions-resolver.service';
import { AgentOrdersService } from '../../agents/orders/agent-orders.service';
import type { CreateAgentOrderDto } from '../../agents/orders/dto/agent-order.dto';
import { StoreOrderDuplicatesService } from '../../store-orders/duplicates/store-order-duplicates.service';
import { resolvePaymentType } from '../../store-orders/payment-type.catalog';
import type { AgentRequestContext } from '../../auth/guards/jwt-auth.guard';
import type { ImportActor, ImportRowResult } from '../import-type.interface';
import { ImportOwnerService } from './import-owner.service';
import {
  createdOrderResult,
  findImportedOrder,
  ImportedOrderService,
} from './imported-order.service';
import { declarationKindFor, type ImportedOrderRows } from './store-order-rows';
import { agentOrderImportKey, agentOrderImportMarker } from './import-row-key';
import {
  duplicateNeedsReview,
  repeatOrderResolution,
} from './import-duplicate-review';

/** An agent user's declaration needs this key (same as the portal order form). */
const AGENT_DECLARE_PERMISSION = 'agent.payments.declare';

/**
 * R15 (spec §3) — an agent user's one-time store-order import row (group).
 * The agent is always the importer's (from the token — an Agent column in the
 * file is never read); products resolve in that agent's catalogue only; every
 * agent rule (agreement in force, agreed pricing, shipping agreement tariff,
 * currency, commission coverage, duplicate gate in the agent's scope,
 * declaration to an agent payment destination) is enforced by
 * `AgentOrdersService` — its quote issues become row errors. The row key is
 * the order's client key, so a retry is skipped.
 */
@Injectable()
export class AgentStoreOrderImportService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly permissions: PermissionsResolverService,
    private readonly agentOrders: AgentOrdersService,
    private readonly duplicates: StoreOrderDuplicatesService,
    private readonly orders: ImportedOrderService,
    private readonly owners: ImportOwnerService,
  ) {}

  async importGroup(
    rows: Record<string, string>[],
    actor: ImportActor & { agent: AgentRequestContext },
    mode: { dryRun?: boolean; confirmed?: boolean },
  ): Promise<ImportRowResult> {
    const { agent } = actor;
    const order = await this.orders.prepare(rows, actor);
    const { parsed, countryId, phone, products, currencyId, hash } = order;
    const { first } = parsed;
    const marker = agentOrderImportMarker(agent.agentId, hash);
    const imported = await findImportedOrder(this.prisma, marker);
    if (imported) return imported;

    // The importer owns the order unless an Owner column names a colleague and
    // the importer holds `agent.records.assign` (ImportOwnerService).
    const ownerUserId = await this.owners.resolve(
      first.agentEmail,
      actor,
      'ORDER',
    );

    const paymentType = resolvePaymentType(first.paymentType);
    if (
      paymentType &&
      paymentType !== 'PREPAID' &&
      paymentType !== 'CASH_ON_DELIVERY'
    ) {
      throw new BadRequestException(
        'نوع الدفع لطلبات الوكيل: مسبق الدفع أو الدفع عند الاستلام — Agent orders are prepaid or cash on delivery.',
      );
    }
    const pricing = {
      pricingMode: 'SHIPPING_ADDED' as const,
      lines: parsed.lines.map((line, index) => ({
        productId: products[index].id,
        quantity: line.quantity,
        lineAmount: line.lineAmount,
      })),
      paymentType: paymentType ?? undefined,
      countryId,
      city: first.city?.trim() || undefined,
      address: first.address?.trim() || undefined,
      currencyId,
      orderDate: parsed.orderDate,
    };
    const agentActor = { userId: actor.userId, agent };
    const quote = await this.agentOrders.quote(pricing, agentActor);
    if (!quote.valid) {
      throw new BadRequestException({
        code: 'AGENT_ORDER_INVALID',
        message: quote.issues.map((issue) => issue.message).join(' | '),
      });
    }
    const declaration = await this.declarationFor(
      parsed,
      actor,
      quote.breakdown?.payableTotal ?? 0,
      hash,
    );
    const duplicateResolution = repeatOrderResolution(
      parsed.repeatCustomer || !!mode.confirmed,
    );

    if (mode.dryRun) {
      try {
        await this.duplicates.enforce(
          { phone, name: first.customerName },
          await this.duplicates.agentScope(agent),
          duplicateResolution,
        );
      } catch (error) {
        throw duplicateNeedsReview(error);
      }
      const warnings = await this.orders.stockWarnings(order);
      return { id: 'dry-run', ...(warnings.length ? { warnings } : {}) };
    }

    const input: CreateAgentOrderDto = {
      ...pricing,
      customer: {
        name: first.customerName.trim(),
        mobile: phone,
        countryId,
        city: pricing.city,
        address: pricing.address,
      },
      notes: first.notes?.trim() || undefined,
      idempotencyKey: agentOrderImportKey(hash),
      ownerUserId,
      duplicateResolution,
      declaration: declaration ?? undefined,
    };
    let created: Awaited<ReturnType<AgentOrdersService['createAgentOrder']>>;
    try {
      created = await this.agentOrders.createAgentOrder(input, agentActor);
    } catch (error) {
      throw duplicateNeedsReview(error);
    }
    if ('idempotentReplay' in created) {
      return (await findImportedOrder(this.prisma, marker))!;
    }
    return createdOrderResult(this.prisma, created.id);
  }

  /**
   * A stated Paid Amount → the agent declaration: the kind against the
   * quoted payable total, paid into one of the agent's active payment
   * destinations (Payment Method column: the destination's label, or a
   * payment method the agent has exactly one destination for).
   */
  private async declarationFor(
    parsed: ImportedOrderRows,
    actor: ImportActor & { agent: AgentRequestContext },
    payableTotal: number,
    hash: string,
  ): Promise<CreateAgentOrderDto['declaration'] | null> {
    if (parsed.paidAmount === null) return null;
    const { kind, amount } = declarationKindFor(
      parsed.paidAmount,
      payableTotal,
    );
    if (kind === 'UNPAID') {
      return { kind, idempotencyKey: `import:${hash}` };
    }
    if (
      !(await this.permissions.hasPermission(
        actor.userId,
        AGENT_DECLARE_PERMISSION,
      ))
    ) {
      throw new BadRequestException(
        `تسجيل مبلغ مدفوع يتطلب صلاحية ${AGENT_DECLARE_PERMISSION} — A Paid Amount needs the ${AGENT_DECLARE_PERMISSION} permission.`,
      );
    }
    return {
      kind,
      amount,
      destinationId: await this.resolveDestination(
        actor.agent.agentId,
        parsed.first.paymentMethodLabel,
      ),
      paymentDate: parsed.paymentDate,
      idempotencyKey: `import:${hash}`,
    };
  }

  private async resolveDestination(agentId: string, value: string | undefined) {
    const text = value?.trim().toLocaleLowerCase();
    if (!text) {
      throw new BadRequestException(
        'طريقة الدفع مطلوبة عند وجود مبلغ مدفوع — Payment Method is required when a Paid Amount is given.',
      );
    }
    const destinations = await this.prisma.agentPaymentDestination.findMany({
      where: { agentId, isActive: true },
      select: {
        id: true,
        label: true,
        paymentMethod: { select: { name: true } },
      },
    });
    const byLabel = destinations.filter(
      (destination) => destination.label.trim().toLocaleLowerCase() === text,
    );
    const matches = byLabel.length
      ? byLabel
      : destinations.filter(
          (destination) =>
            destination.paymentMethod.name.trim().toLocaleLowerCase() === text,
        );
    if (matches.length === 1) return matches[0].id;
    const available =
      destinations.map((destination) => destination.label).join('، ') || '—';
    throw new BadRequestException(
      `طريقة الدفع «${value}» ليست وجهة دفع واحدة لدى الوكيل (المتاح: ${available}) — Payment Method "${value}" is not exactly one of your payment destinations (available: ${available}).`,
    );
  }
}
