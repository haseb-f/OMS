import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  CostAccountingClass,
  CostAllocationMethod,
  LandedCostStatus,
  PurchaseDocumentStatus,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { NumberingEngineService } from '../numbering/numbering-engine.service';
import { PostingEngineService } from '../accounting/posting-engine/posting-engine.service';
import { CostComponentsService } from '../cost-components/cost-components.service';
import { computeSalesLine, round2 } from '../sales/shared/sales-totals.util';
import { resolveTaxesById } from '../taxes/document-tax';
import { allocateProportionally } from './landed-cost-allocation.util';
import { unprocessable } from '../common/errors/business-errors';
import { CreateLandedCostDocumentDto } from './dto/create-landed-cost-document.dto';
import { UpdateLandedCostDocumentDto } from './dto/update-landed-cost-document.dto';

const DOCUMENT_TYPE = 'LANDED_COST';

/**
 * R13 (spec §4) — outbound delivery and payment-fee costs are never
 * capitalized into inventory: enforced by the component's accounting class,
 * not only by its `capitalizable` flag.
 */
const NON_CAPITALIZABLE_CLASSES: CostAccountingClass[] = [
  CostAccountingClass.FULFILLMENT,
  CostAccountingClass.TRANSACTION,
];

function assertCapitalizableClass(component: {
  id: string;
  name: string;
  accountingClass: CostAccountingClass;
}) {
  if (!NON_CAPITALIZABLE_CLASSES.includes(component.accountingClass)) return;
  throw unprocessable(
    'LANDED_COST_CLASS_NOT_CAPITALIZABLE',
    `Cost Category "${component.name}" is a ${component.accountingClass} cost — outbound delivery and payment fees are expensed, never capitalized into inventory.`,
    {
      costComponentId: component.id,
      accountingClass: component.accountingClass,
    },
  );
}

const DOCUMENT_INCLUDE = {
  lines: { include: { costComponent: true, tax: true } },
  allocations: {
    include: { purchaseInvoiceItem: { include: { product: true } } },
  },
  purchaseInvoice: { select: { id: true, invoiceNumber: true, status: true } },
  provider: { select: { id: true, name: true } },
  currency: { select: { id: true, code: true, name: true } },
  activities: { orderBy: { createdAt: 'desc' } },
} as const;

export interface AllocationPreviewLine {
  purchaseInvoiceItemId: string;
  productId: string;
  productName: string;
  quantity: number;
  purchaseValue: number;
  allocatedAmount: number;
}

export interface AllocationPreview {
  method: CostAllocationMethod;
  netTotal: number;
  lines: AllocationPreviewLine[];
  allocatedTotal: number;
  difference: number;
}

@Injectable()
export class LandedCostDocumentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly numberingEngine: NumberingEngineService,
    private readonly postingEngine: PostingEngineService,
    private readonly costComponents: CostComponentsService,
  ) {}

  async create(dto: CreateLandedCostDocumentDto, userId?: string) {
    const invoice = await this.prisma.purchaseInvoice.findFirst({
      where: { id: dto.purchaseInvoiceId, deletedAt: null },
      select: { id: true, invoiceNumber: true, status: true },
    });
    if (!invoice) {
      throw new BadRequestException(
        `Purchase Invoice ${dto.purchaseInvoiceId} not found.`,
      );
    }
    // Landed Cost attaches to the actual receipt event in this OMS — a
    // Purchase Invoice only increases Inventory once CONFIRMED (there is no
    // separate Goods Receipt entity, see ADR-0017) — so a DRAFT/APPROVED
    // invoice has no receipt to attach acquisition cost to yet, and a
    // CANCELLED/CLOSED one is not a valid target either.
    if (invoice.status !== PurchaseDocumentStatus.CONFIRMED) {
      throw new BadRequestException(
        `Landed Cost can only attach to a CONFIRMED Purchase Invoice (the actual receipt event) — ${invoice.invoiceNumber} is ${invoice.status}.`,
      );
    }

    const taxById = await resolveTaxesById(
      this.prisma,
      dto.lines.map((line) => line.taxId),
    );
    const lineInputs = await Promise.all(
      dto.lines.map(async (line) => {
        await this.assertLandedCostComponent(line.costComponentId);
        const tax = line.taxId ? taxById.get(line.taxId) : undefined;
        const computed = computeSalesLine({
          quantity: 1,
          unitPrice: line.netAmount,
          taxRatePercent: tax?.rate,
          taxInclusive: tax?.inclusive,
        });
        return {
          costComponentId: line.costComponentId,
          description: line.description,
          netAmount: tax?.inclusive
            ? round2(computed.lineTotal - computed.taxAmount)
            : computed.lineSubtotal,
          taxId: line.taxId,
          taxAmount: computed.taxAmount,
        };
      }),
    );
    const netTotal = round2(
      lineInputs.reduce((sum, l) => sum + l.netAmount, 0),
    );
    const taxTotal = round2(
      lineInputs.reduce((sum, l) => sum + l.taxAmount, 0),
    );

    const documentNumber =
      await this.numberingEngine.generateNumber(DOCUMENT_TYPE);

    return this.prisma.$transaction(async (tx) => {
      const document = await tx.landedCostDocument.create({
        data: {
          documentNumber,
          purchaseInvoiceId: dto.purchaseInvoiceId,
          providerId: dto.providerId,
          currencyId: dto.currencyId,
          referenceNumber: dto.referenceNumber,
          documentDate: new Date(dto.documentDate),
          allocationMethod: dto.allocationMethod,
          netTotal,
          taxTotal,
          createdBy: userId,
          updatedBy: userId,
          lines: { create: lineInputs },
        },
        include: DOCUMENT_INCLUDE,
      });
      await tx.landedCostActivity.create({
        data: {
          landedCostDocumentId: document.id,
          type: 'LANDED_COST_CREATED',
          description: `Landed Cost ${document.documentNumber} created for Purchase Invoice ${invoice.invoiceNumber}`,
          createdBy: userId,
        },
      });
      return document;
    });
  }

  async findAll() {
    return this.prisma.landedCostDocument.findMany({
      where: { deletedAt: null },
      include: DOCUMENT_INCLUDE,
      orderBy: { createdAt: 'desc' },
    });
  }

  async findOne(id: string) {
    const document = await this.prisma.landedCostDocument.findFirst({
      where: { id, deletedAt: null },
      include: DOCUMENT_INCLUDE,
    });
    if (!document) {
      throw new NotFoundException(`Landed Cost document ${id} not found`);
    }
    return document;
  }

  async update(id: string, dto: UpdateLandedCostDocumentDto, userId?: string) {
    const existing = await this.findOne(id);
    if (existing.status !== LandedCostStatus.DRAFT) {
      throw new BadRequestException(
        `Landed Cost ${existing.documentNumber} can only be edited while DRAFT (currently ${existing.status}).`,
      );
    }

    let netTotal = Number(existing.netTotal);
    let taxTotal = Number(existing.taxTotal);
    const taxById = dto.lines
      ? await resolveTaxesById(
          this.prisma,
          dto.lines.map((line) => line.taxId),
        )
      : null;
    const lineInputs = dto.lines
      ? await Promise.all(
          dto.lines.map(async (line) => {
            await this.assertLandedCostComponent(line.costComponentId);
            const tax = line.taxId ? taxById?.get(line.taxId) : undefined;
            const computed = computeSalesLine({
              quantity: 1,
              unitPrice: line.netAmount,
              taxRatePercent: tax?.rate,
              taxInclusive: tax?.inclusive,
            });
            return {
              costComponentId: line.costComponentId,
              description: line.description,
              netAmount: tax?.inclusive
                ? round2(computed.lineTotal - computed.taxAmount)
                : computed.lineSubtotal,
              taxId: line.taxId,
              taxAmount: computed.taxAmount,
            };
          }),
        )
      : null;
    if (lineInputs) {
      netTotal = round2(lineInputs.reduce((sum, l) => sum + l.netAmount, 0));
      taxTotal = round2(lineInputs.reduce((sum, l) => sum + l.taxAmount, 0));
    }

    return this.prisma.$transaction(async (tx) => {
      if (lineInputs) {
        await tx.landedCostLine.deleteMany({
          where: { landedCostDocumentId: id },
        });
      }
      const document = await tx.landedCostDocument.update({
        where: { id },
        data: {
          providerId: dto.providerId,
          currencyId: dto.currencyId,
          referenceNumber: dto.referenceNumber,
          documentDate: dto.documentDate
            ? new Date(dto.documentDate)
            : undefined,
          allocationMethod: dto.allocationMethod,
          netTotal,
          taxTotal,
          updatedBy: userId,
          ...(lineInputs ? { lines: { create: lineInputs } } : {}),
        },
        include: DOCUMENT_INCLUDE,
      });
      await tx.landedCostActivity.create({
        data: {
          landedCostDocumentId: id,
          type: 'LANDED_COST_UPDATED',
          description: `Landed Cost ${document.documentNumber} updated`,
          createdBy: userId,
        },
      });
      return document;
    });
  }

  /**
   * Read-only allocation preview — never persists. Only Purchase Invoice
   * lines whose Product is an actual inventory item are included in the
   * allocation base (a service/non-inventory line on the same invoice has
   * no inventory value to capitalize into).
   */
  async previewAllocation(id: string): Promise<AllocationPreview> {
    const document = await this.findOne(id);
    const items = await this.prisma.purchaseInvoiceItem.findMany({
      where: { purchaseInvoiceId: document.purchaseInvoiceId },
      include: {
        product: { select: { id: true, name: true, isInventoryItem: true } },
      },
    });
    const eligible = items.filter((item) => item.product.isInventoryItem);
    if (eligible.length === 0) {
      throw new BadRequestException(
        'This Purchase Invoice has no inventory-item lines to allocate landed cost across.',
      );
    }

    const bases = eligible.map((item) => ({
      key: item.id,
      weight:
        document.allocationMethod === CostAllocationMethod.BY_QUANTITY
          ? item.quantity
          : item.quantity * Number(item.unitPrice),
    }));
    const netTotal = Number(document.netTotal);
    const allocations = allocateProportionally(netTotal, bases);
    const allocationByKey = new Map(allocations.map((a) => [a.key, a.amount]));

    const lines: AllocationPreviewLine[] = eligible.map((item) => ({
      purchaseInvoiceItemId: item.id,
      productId: item.productId,
      productName: item.product.name,
      quantity: item.quantity,
      purchaseValue: round2(item.quantity * Number(item.unitPrice)),
      allocatedAmount: allocationByKey.get(item.id) ?? 0,
    }));
    const allocatedTotal = round2(
      lines.reduce((sum, l) => sum + l.allocatedAmount, 0),
    );

    return {
      method: document.allocationMethod,
      netTotal,
      lines,
      allocatedTotal,
      difference: round2(netTotal - allocatedTotal),
    };
  }

  /** DRAFT → APPROVED: persists the allocation preview, locking it in before posting. */
  async approve(id: string, userId?: string) {
    const document = await this.findOne(id);
    if (document.status !== LandedCostStatus.DRAFT) {
      throw new BadRequestException(
        `Landed Cost ${document.documentNumber} is ${document.status}, not DRAFT.`,
      );
    }
    // A component reclassified since the line was entered is caught here,
    // before the allocation is locked in.
    for (const line of document.lines)
      assertCapitalizableClass(line.costComponent);
    const preview = await this.previewAllocation(id);
    if (preview.difference !== 0) {
      // The allocation utility guarantees this never happens — this is a
      // last-resort integrity guard, not an expected code path.
      throw new BadRequestException(
        `Allocation does not reconcile — difference of ${preview.difference}. Posting is blocked until it is exactly 0.`,
      );
    }

    return this.prisma.$transaction(async (tx) => {
      await tx.landedCostAllocation.deleteMany({
        where: { landedCostDocumentId: id },
      });
      await tx.landedCostAllocation.createMany({
        data: preview.lines.map((line) => ({
          landedCostDocumentId: id,
          purchaseInvoiceItemId: line.purchaseInvoiceItemId,
          allocatedQuantity: line.quantity,
          allocatedAmount: line.allocatedAmount,
        })),
      });
      const updated = await tx.landedCostDocument.update({
        where: { id },
        data: {
          status: LandedCostStatus.APPROVED,
          approvedAt: new Date(),
          approvedBy: userId,
        },
        include: DOCUMENT_INCLUDE,
      });
      await tx.landedCostActivity.create({
        data: {
          landedCostDocumentId: id,
          type: 'LANDED_COST_APPROVED',
          description: `Landed Cost ${updated.documentNumber} approved — allocation locked (${preview.method}, total ${preview.netTotal})`,
          createdBy: userId,
        },
      });
      return updated;
    });
  }

  /** APPROVED → POSTED: capitalizes into inventory valuation and posts through the canonical Posting Engine — one atomic transaction. */
  async post(id: string, userId?: string) {
    const document = await this.findOne(id);
    if (document.status !== LandedCostStatus.APPROVED) {
      throw new BadRequestException(
        `Landed Cost ${document.documentNumber} is ${document.status}, not APPROVED.`,
      );
    }
    if (document.allocations.length === 0) {
      throw new BadRequestException(
        `Landed Cost ${document.documentNumber} has no locked allocation to post.`,
      );
    }

    return this.prisma.$transaction(async (tx) => {
      const claimed = await tx.landedCostDocument.updateMany({
        where: { id, status: LandedCostStatus.APPROVED },
        data: {
          status: LandedCostStatus.POSTED,
          postedAt: new Date(),
          postedBy: userId,
        },
      });
      if (claimed.count === 0) {
        throw new BadRequestException(
          `Landed Cost ${document.documentNumber} was changed by someone else — reload and try again.`,
        );
      }
      await this.postingEngine.post('LANDED_COST', id, userId, tx);
      // Re-read after posting: the frozen rate and each allocation's
      // capitalized / variance split are written by the posting itself.
      const updated = await tx.landedCostDocument.findUniqueOrThrow({
        where: { id },
        include: DOCUMENT_INCLUDE,
      });
      const capitalized = updated.allocations.reduce(
        (sum, allocation) => sum + Number(allocation.capitalizedAmount ?? 0),
        0,
      );
      const variance = updated.allocations.reduce(
        (sum, allocation) => sum + Number(allocation.cogsVarianceAmount ?? 0),
        0,
      );
      await tx.landedCostActivity.create({
        data: {
          landedCostDocumentId: id,
          type: 'LANDED_COST_POSTED',
          description: `Landed Cost ${updated.documentNumber} posted — ${round2(capitalized)} capitalized into inventory, ${round2(variance)} to cost of goods sold (units already sold)`,
          createdBy: userId,
        },
      });
      return updated;
    });
  }

  /** The R13 class rule (checked first, so a delivery / payment-fee cost always gets its own 422), then the existing capitalizable rule (active, flagged capitalizable). */
  private async assertLandedCostComponent(costComponentId: string) {
    const classified = await this.prisma.costComponent.findFirst({
      where: { id: costComponentId, deletedAt: null },
      select: { id: true, name: true, accountingClass: true },
    });
    if (classified) assertCapitalizableClass(classified);
    return this.costComponents.assertCapitalizable(costComponentId);
  }

  async cancel(id: string, userId?: string) {
    const document = await this.findOne(id);
    if (
      document.status !== LandedCostStatus.DRAFT &&
      document.status !== LandedCostStatus.APPROVED
    ) {
      throw new BadRequestException(
        `Landed Cost ${document.documentNumber} is ${document.status} and can no longer be cancelled — a POSTED document requires a reversal, not a cancel.`,
      );
    }
    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.landedCostDocument.update({
        where: { id },
        data: {
          status: LandedCostStatus.CANCELLED,
          cancelledAt: new Date(),
          cancelledBy: userId,
        },
        include: DOCUMENT_INCLUDE,
      });
      await tx.landedCostActivity.create({
        data: {
          landedCostDocumentId: id,
          type: 'LANDED_COST_CANCELLED',
          description: `Landed Cost ${updated.documentNumber} cancelled`,
          createdBy: userId,
        },
      });
      return updated;
    });
  }
}
