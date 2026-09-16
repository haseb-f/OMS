import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { createHash } from 'node:crypto';
import { CarrierReconciliationState, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { MasterDataActivityLogService } from '../master-data/master-data-activity-log.service';
import { parseCsv } from '../import-center/csv-parser.util';
import { normalizeExternalOrderId } from '../import-center/sync/store-orders-sync.lifecycle';

const ENTITY_TYPE = 'CARRIER_CHARGE';

export interface CarrierChargeImportRowError {
  row: number;
  message: string;
}

export interface CarrierChargeImportSummary {
  importId: string;
  totalRows: number;
  matchedRows: number;
  reviewRows: number;
  unmatchedRows: number;
  duplicateRows: number;
  errorRows: CarrierChargeImportRowError[];
}

/**
 * ADR-0018 (Order Economics M2 gap closure) — the carrier-neutral
 * reconciliation layer between an imported carrier charge line and a
 * Shipment Attempt. Deliberately NOT a second Accounts Payable system: it
 * determines the ACTUAL/CONFIRMED ACTUAL shipping cost `OrderEconomicsService`
 * reads, nothing more. Posting a real carrier invoice into AP (Supplier/
 * ChartOfAccount/Journal) stays the existing Purchasing/Expenses flow's
 * job — see the class-level boundary note below (Part 11 of the gap-closure
 * spec): if/when a real carrier AP document needs posting, it should link
 * to the CONFIRMED CarrierCharge rows it settles, not duplicate them.
 */
@Injectable()
export class CarrierReconciliationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly activityLog: MasterDataActivityLogService,
  ) {}

  /**
   * Deterministic idempotency key (Part 10) — carrier + carrierReference
   * when the carrier gives one (the strongest signal), else carrier +
   * tracking + amount + date. Importing the same file/line twice always
   * collides on this key rather than creating a second economic cost.
   */
  private dedupeKey(row: {
    carrierNameRaw: string;
    carrierReference?: string | null;
    trackingNumber?: string | null;
    chargeAmount: number;
    chargeDate: string;
  }): string {
    const carrier = row.carrierNameRaw.trim().toLowerCase();
    const identity = row.carrierReference?.trim()
      ? `ref:${row.carrierReference.trim().toLowerCase()}`
      : `fallback:${(row.trackingNumber ?? '').trim().toLowerCase()}:${row.chargeAmount.toFixed(2)}:${row.chargeDate}`;
    return createHash('sha256').update(`${carrier}|${identity}`).digest('hex');
  }

  /**
   * Finds the candidate Shipment(s) for one charge row, in priority order
   * (Part 3): tracking number first (points at one exact Attempt), then
   * Order Number (Shipment Reference) — which is ambiguous whenever the
   * Order has more than one Shipment Attempt. Never matches on customer
   * name/phone. Returns REVIEW_REQUIRED candidates unresolved (caller
   * decides state) rather than guessing.
   */
  private async findCandidateShipments(row: {
    trackingNumber?: string | null;
    shipmentReference?: string | null;
  }): Promise<{ id: string }[]> {
    if (row.trackingNumber?.trim()) {
      const byTracking = await this.prisma.shipment.findMany({
        where: {
          deletedAt: null,
          trackingNumber: {
            equals: row.trackingNumber.trim(),
            mode: 'insensitive',
          },
        },
        select: { id: true },
      });
      if (byTracking.length > 0) return byTracking;
    }

    if (row.shipmentReference?.trim()) {
      const normalized = normalizeExternalOrderId(row.shipmentReference);
      const order = await this.prisma.storeOrder.findFirst({
        where: {
          deletedAt: null,
          OR: [
            {
              internalOrderId: {
                equals: row.shipmentReference.trim(),
                mode: 'insensitive',
              },
            },
            { externalOrderId: { equals: normalized, mode: 'insensitive' } },
          ],
        },
        select: { id: true },
      });
      if (order) {
        return this.prisma.shipment.findMany({
          where: { storeOrderId: order.id, deletedAt: null },
          select: { id: true },
        });
      }
    }

    return [];
  }

  private async resolveShippingCompanyId(
    carrierNameRaw: string,
  ): Promise<string | null> {
    const company = await this.prisma.shippingCompany.findFirst({
      where: {
        deletedAt: null,
        name: { equals: carrierNameRaw.trim(), mode: 'insensitive' },
      },
      select: { id: true },
    });
    return company?.id ?? null;
  }

  private async resolveCurrencyId(code: string): Promise<string | null> {
    const currency = await this.prisma.currency.findFirst({
      where: {
        deletedAt: null,
        code: { equals: code.trim(), mode: 'insensitive' },
      },
      select: { id: true },
    });
    return currency?.id ?? null;
  }

  /**
   * Canonical import structure (Part 8): Carrier, Carrier Reference,
   * Tracking Number, Shipment Reference, Charge Amount, Currency, Charge
   * Date, Charge Type (optional). Carrier-neutral — never hardcodes a
   * specific carrier's file format.
   */
  async importCsv(
    fileContent: string,
    fileName: string,
    userId?: string,
  ): Promise<CarrierChargeImportSummary> {
    const { rows } = parseCsv(fileContent);
    if (rows.length === 0) {
      throw new BadRequestException('The file has no data rows.');
    }

    const importRow = await this.prisma.carrierChargeImport.create({
      data: { fileName, importedBy: userId ?? null },
    });

    let matchedRows = 0;
    let reviewRows = 0;
    let unmatchedRows = 0;
    let duplicateRows = 0;
    const errorRows: CarrierChargeImportRowError[] = [];

    for (const [index, row] of rows.entries()) {
      const rowNumber = index + 2; // 1-indexed + header row
      const carrierNameRaw = row['Carrier']?.trim();
      const chargeAmountRaw = row['Charge Amount']?.trim();
      const currencyCode = row['Currency']?.trim();
      const chargeDateRaw = row['Charge Date']?.trim();

      if (
        !carrierNameRaw ||
        !chargeAmountRaw ||
        !currencyCode ||
        !chargeDateRaw
      ) {
        errorRows.push({
          row: rowNumber,
          message:
            'Carrier, Charge Amount, Currency, and Charge Date are required.',
        });
        continue;
      }
      const chargeAmount = Number(chargeAmountRaw);
      if (!Number.isFinite(chargeAmount) || chargeAmount < 0) {
        errorRows.push({
          row: rowNumber,
          message: `Invalid Charge Amount "${chargeAmountRaw}".`,
        });
        continue;
      }
      const chargeDate = new Date(chargeDateRaw);
      if (Number.isNaN(chargeDate.getTime())) {
        errorRows.push({
          row: rowNumber,
          message: `Invalid Charge Date "${chargeDateRaw}".`,
        });
        continue;
      }
      const currencyId = await this.resolveCurrencyId(currencyCode);
      if (!currencyId) {
        errorRows.push({
          row: rowNumber,
          message: `Unknown Currency code "${currencyCode}".`,
        });
        continue;
      }

      const carrierReference = row['Carrier Reference']?.trim() || null;
      const trackingNumber = row['Tracking Number']?.trim() || null;
      const shipmentReference = row['Shipment Reference']?.trim() || null;
      const chargeType = row['Charge Type']?.trim() || null;

      const dedupeKey = this.dedupeKey({
        carrierNameRaw,
        carrierReference,
        trackingNumber,
        chargeAmount,
        chargeDate: chargeDateRaw,
      });

      const existing = await this.prisma.carrierCharge.findUnique({
        where: { dedupeKey },
      });
      if (existing) {
        duplicateRows++;
        continue;
      }

      const candidates = await this.findCandidateShipments({
        trackingNumber,
        shipmentReference,
      });
      const shippingCompanyId =
        await this.resolveShippingCompanyId(carrierNameRaw);

      let reconciliationState: CarrierReconciliationState = 'UNMATCHED';
      let shipmentId: string | null = null;
      if (candidates.length === 1) {
        reconciliationState = 'MATCHED';
        shipmentId = candidates[0].id;
        matchedRows++;
      } else if (candidates.length > 1) {
        reconciliationState = 'REVIEW_REQUIRED';
        reviewRows++;
      } else {
        unmatchedRows++;
      }

      const charge = await this.prisma.carrierCharge.create({
        data: {
          importId: importRow.id,
          carrierNameRaw,
          shippingCompanyId,
          carrierReference,
          trackingNumber,
          shipmentReference,
          chargeAmount,
          currencyId,
          chargeDate,
          chargeType,
          dedupeKey,
          shipmentId,
          reconciliationState,
          matchedAt: shipmentId ? new Date() : null,
          matchedBy: shipmentId ? (userId ?? null) : null,
          createdBy: userId ?? null,
        },
      });

      await this.activityLog.log(
        ENTITY_TYPE,
        charge.id,
        'IMPORTED',
        `Carrier charge imported from "${fileName}" — ${reconciliationState}`,
        userId,
      );
    }

    await this.prisma.carrierChargeImport.update({
      where: { id: importRow.id },
      data: {
        totalRows: rows.length,
        matchedRows,
        reviewRows,
        unmatchedRows,
        duplicateRows,
      },
    });

    return {
      importId: importRow.id,
      totalRows: rows.length,
      matchedRows,
      reviewRows,
      unmatchedRows,
      duplicateRows,
      errorRows,
    };
  }

  /** Manual-match lookup (Part 4/13) — resolves an Order Number to its Shipment Attempts, so a reviewer can pick the right one without a generic Shipment search. */
  async findShipmentCandidatesByOrderNumber(orderNumber: string) {
    const normalized = normalizeExternalOrderId(orderNumber);
    const order = await this.prisma.storeOrder.findFirst({
      where: {
        deletedAt: null,
        OR: [
          {
            internalOrderId: {
              equals: orderNumber.trim(),
              mode: 'insensitive',
            },
          },
          { externalOrderId: { equals: normalized, mode: 'insensitive' } },
        ],
      },
      select: { id: true, internalOrderId: true },
    });
    if (!order) return { orderId: null, internalOrderId: null, shipments: [] };
    const shipments = await this.prisma.shipment.findMany({
      where: { storeOrderId: order.id, deletedAt: null },
      select: {
        id: true,
        attemptNumber: true,
        status: true,
        trackingNumber: true,
      },
      orderBy: { attemptNumber: 'asc' },
    });
    return {
      orderId: order.id,
      internalOrderId: order.internalOrderId,
      shipments,
    };
  }

  async findAll(query: {
    state?: CarrierReconciliationState;
    search?: string;
    page?: number;
    pageSize?: number;
  }) {
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 20;
    const where: Prisma.CarrierChargeWhereInput = {
      deletedAt: null,
      reconciliationState: query.state,
      OR: query.search
        ? [
            { carrierNameRaw: { contains: query.search, mode: 'insensitive' } },
            {
              carrierReference: { contains: query.search, mode: 'insensitive' },
            },
            { trackingNumber: { contains: query.search, mode: 'insensitive' } },
            {
              shipmentReference: {
                contains: query.search,
                mode: 'insensitive',
              },
            },
          ]
        : undefined,
    };
    const [items, total] = await Promise.all([
      this.prisma.carrierCharge.findMany({
        where,
        skip: (page - 1) * pageSize,
        take: pageSize,
        orderBy: { createdAt: 'desc' },
        include: {
          currency: { select: { code: true } },
          shippingCompany: { select: { id: true, name: true } },
          shipment: {
            select: {
              id: true,
              attemptNumber: true,
              storeOrderId: true,
              storeOrder: { select: { id: true, internalOrderId: true } },
            },
          },
        },
      }),
      this.prisma.carrierCharge.count({ where }),
    ]);
    return { items, total, page, pageSize };
  }

  async findOne(id: string) {
    const charge = await this.prisma.carrierCharge.findFirst({
      where: { id, deletedAt: null },
      include: {
        currency: { select: { code: true } },
        shippingCompany: { select: { id: true, name: true } },
        shipment: {
          select: {
            id: true,
            attemptNumber: true,
            storeOrderId: true,
            storeOrder: { select: { id: true, internalOrderId: true } },
          },
        },
      },
    });
    if (!charge) throw new NotFoundException(`Carrier charge ${id} not found`);
    return charge;
  }

  activityFor(id: string) {
    return this.activityLog.findForEntity(ENTITY_TYPE, id);
  }

  /** Manual rematch (Part 4/13) — moves a REVIEW_REQUIRED/UNMATCHED (or already-MATCHED) charge onto an explicit Shipment. Never auto-confirms. */
  async match(id: string, shipmentId: string, userId?: string) {
    const charge = await this.findOne(id);
    if (charge.reconciliationState === 'CONFIRMED') {
      throw new ConflictException(
        'This charge is already CONFIRMED — unmatch it first to rematch.',
      );
    }
    const shipment = await this.prisma.shipment.findFirst({
      where: { id: shipmentId, deletedAt: null },
    });
    if (!shipment)
      throw new NotFoundException(`Shipment ${shipmentId} not found`);

    const updated = await this.prisma.carrierCharge.update({
      where: { id },
      data: {
        shipmentId,
        reconciliationState: 'MATCHED',
        matchedAt: new Date(),
        matchedBy: userId ?? null,
      },
    });
    await this.activityLog.log(
      ENTITY_TYPE,
      id,
      'MATCHED',
      `Manually matched to Shipment Attempt #${shipment.attemptNumber} (${shipmentId})`,
      userId,
    );
    return updated;
  }

  /** Reversal (Part 4/13) — clears the match; if the charge was CONFIRMED, this also removes it as that Shipment's authoritative actual cost. */
  async unmatch(id: string, userId?: string) {
    const charge = await this.findOne(id);
    const updated = await this.prisma.carrierCharge.update({
      where: { id },
      data: {
        shipmentId: null,
        reconciliationState: 'UNMATCHED',
        matchedAt: null,
        matchedBy: null,
        confirmedAt: null,
        confirmedBy: null,
      },
    });
    await this.activityLog.log(
      ENTITY_TYPE,
      id,
      'UNMATCHED',
      `Unmatched from Shipment ${charge.shipmentId ?? 'unknown'} (was ${charge.reconciliationState})`,
      userId,
    );
    return updated;
  }

  /**
   * CONFIRMED ACTUAL (Part 5) — the one action that changes Order
   * Economics: `OrderEconomicsService` reads a CONFIRMED charge's
   * `chargeAmount` ahead of the Shipment's own operationally-entered
   * base/additional cost. At most one CONFIRMED charge per Shipment
   * (enforced here, not by a schema constraint) — confirming a second one
   * for the same Shipment requires explicitly unmatching the first.
   */
  async confirm(id: string, userId?: string) {
    const charge = await this.findOne(id);
    if (!charge.shipmentId) {
      throw new BadRequestException(
        'Match this charge to a Shipment before confirming it.',
      );
    }
    const existingConfirmed = await this.prisma.carrierCharge.findFirst({
      where: {
        shipmentId: charge.shipmentId,
        reconciliationState: 'CONFIRMED',
        deletedAt: null,
        id: { not: id },
      },
    });
    if (existingConfirmed) {
      throw new ConflictException(
        `Shipment already has a CONFIRMED carrier charge (${existingConfirmed.id}). Unmatch it first.`,
      );
    }

    const updated = await this.prisma.carrierCharge.update({
      where: { id },
      data: {
        reconciliationState: 'CONFIRMED',
        confirmedAt: new Date(),
        confirmedBy: userId ?? null,
      },
    });
    await this.activityLog.log(
      ENTITY_TYPE,
      id,
      'CONFIRMED',
      `Confirmed as authoritative shipping cost (${Number(charge.chargeAmount)}) for Shipment ${charge.shipmentId}`,
      userId,
    );
    return updated;
  }
}
