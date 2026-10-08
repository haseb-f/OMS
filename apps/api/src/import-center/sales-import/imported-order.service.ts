import { BadRequestException, Injectable } from '@nestjs/common';
import { StoreOrderStockStatus } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { CountriesService } from '../../countries/countries.service';
import { PhoneNumberService } from '../../common/phone/phone-number.service';
import { buildStoreOrderPhoneErrorMessage } from '../sync/store-orders-sync.messages';
import { ReferenceDataRegistryService } from '../reference-data/reference-data-registry.service';
import {
  importScope,
  type ImportActor,
  type ImportRowResult,
} from '../import-type.interface';
import {
  ImportCatalogService,
  type CatalogProduct,
} from './import-catalog.service';
import {
  parseImportedOrderRows,
  type ImportedOrderRows,
} from './store-order-rows';
import { importRowHash } from './import-row-key';

/** Bilingual row notice of an order the stock could not cover (W5a `SHORT`). */
export function awaitingStockNotice(orderNumber: string) {
  return `أُنشئ الطلب ${orderNumber} بانتظار المخزون — Order ${orderNumber} was created and awaits stock.`;
}

/** Created rows' result: a notice when the order waits for stock. */
export async function createdOrderResult(
  prisma: PrismaService,
  orderId: string,
): Promise<ImportRowResult> {
  const order = await prisma.storeOrder.findUniqueOrThrow({
    where: { id: orderId },
    select: { stockStatus: true, internalOrderId: true },
  });
  return order.stockStatus === StoreOrderStockStatus.SHORT
    ? { id: orderId, notice: awaitingStockNotice(order.internalOrderId) }
    : { id: orderId };
}

/** An imported order already in OMS under this row key (an archived one is not). */
export async function findImportedOrder(
  prisma: PrismaService,
  creationIdempotencyKey: string,
): Promise<ImportRowResult | null> {
  const existing = await prisma.storeOrder.findUnique({
    where: { creationIdempotencyKey },
    select: { id: true, internalOrderId: true, deletedAt: true },
  });
  if (!existing || existing.deletedAt) return null;
  return {
    id: existing.id,
    skipped: `سبق استيراد هذا الصف كطلب ${existing.internalOrderId} — Already imported as order ${existing.internalOrderId}.`,
  };
}

/** One order group of a one-time import, resolved and keyed. */
export interface PreparedImportedOrder {
  parsed: ImportedOrderRows;
  countryId: string;
  /** The customer phone normalised to E.164 via the row's country. */
  phone: string;
  /** Catalogue product of each line (same order as `parsed.lines`). */
  products: CatalogProduct[];
  currencyId: string;
  /** The row key hash (D15-17) of this order in the importer's scope. */
  hash: string;
}

/**
 * R15 — the shared first half of a company or agent store-order import row:
 * parse (explicit prices, paid amount, repeat flag), country, phone (E.164 via
 * the country — Arabic digits, trunk 0, 00 handled by `PhoneNumberService`),
 * the importer's own catalogue, currency, and the row key.
 */
@Injectable()
export class ImportedOrderService {
  constructor(
    private readonly countries: CountriesService,
    private readonly phones: PhoneNumberService,
    private readonly referenceData: ReferenceDataRegistryService,
    private readonly catalog: ImportCatalogService,
  ) {}

  async prepare(
    rows: Record<string, string>[],
    actor: ImportActor,
  ): Promise<PreparedImportedOrder> {
    const parsed = parseImportedOrderRows(rows);
    const { first } = parsed;
    const countryId = await this.referenceData.resolveRequired(
      'COUNTRY',
      'name',
      first.countryName,
      'Country',
    );
    const country = await this.countries.findOne(countryId);
    const phone = this.phones.parse(first.customerPhone, country.code);
    if (!phone.isValid || !phone.e164) {
      throw new BadRequestException(
        buildStoreOrderPhoneErrorMessage(
          first.customerPhone,
          country.name,
          phone,
        ),
      );
    }
    const products: CatalogProduct[] = [];
    for (const line of parsed.lines) {
      products.push(
        await this.catalog.resolveProduct(actor, line.productValue),
      );
    }
    const currencyId = await this.referenceData.resolveRequired(
      'CURRENCY',
      'code',
      first.currencyCode,
      'Currency',
    );
    const hash = importRowHash(importScope(actor), {
      phone: phone.e164,
      name: first.customerName,
      lines: parsed.lines.map((line, index) => ({
        productId: products[index].id,
        quantity: line.quantity,
        amount: line.lineAmount,
      })),
      orderDate: parsed.orderDay,
      externalId: parsed.externalOrderId,
    });
    return {
      parsed,
      countryId,
      phone: phone.e164,
      products,
      currencyId,
      hash,
    };
  }

  /** Preview: stock warnings of the order's lines. */
  stockWarnings(order: PreparedImportedOrder) {
    return this.catalog.stockWarnings(
      order.parsed.lines.map((line, index) => ({
        product: order.products[index],
        quantity: line.quantity,
      })),
    );
  }
}
