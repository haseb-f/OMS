import { BadRequestException, Injectable, OnModuleInit } from '@nestjs/common';
import { StoreOrderSource } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { CustomersService } from '../../customers/customers.service';
import { CountriesService } from '../../countries/countries.service';
import { StoreOrdersService } from '../../store-orders/store-orders.service';
import {
  PhoneNumberService,
  phoneErrorMessage,
} from '../../common/phone/phone-number.service';
import { ImportTypeRegistryService } from '../import-type-registry.service';
import { ReferenceDataRegistryService } from '../reference-data/reference-data-registry.service';
import {
  listSheetReferenceMatch,
  type ListSheetColumnKey,
} from '../list-sheet/list-sheet.catalog';
import {
  ImportRowNeedsReviewError,
  type ImportFieldDef,
  type ImportRowOptions,
  type ImportRowResult,
  type ImportTypeHandler,
} from '../import-type.interface';

const FIELDS: ImportFieldDef[] = [
  {
    key: 'externalOrderId',
    labelKey: 'importCenter.fields.externalOrderId',
    label: 'External Order ID',
    required: true,
    type: 'string',
    example: 'SH-100234',
  },
  {
    key: 'orderDate',
    labelKey: 'importCenter.fields.orderDate',
    label: 'Order Date',
    required: true,
    type: 'date',
    example: '2026-08-01',
  },
  {
    key: 'customerName',
    labelKey: 'importCenter.fields.name',
    label: 'Customer Name',
    required: true,
    type: 'string',
    example: 'Mohammed Al-Otaibi',
  },
  {
    key: 'customerPhone',
    labelKey: 'importCenter.fields.mobileNumber',
    label: 'Phone',
    required: true,
    type: 'string',
    example: '512345678',
  },
  {
    key: 'countryName',
    labelKey: 'importCenter.fields.countryName',
    label: 'Country',
    required: true,
    type: 'string',
    referenceType: 'COUNTRY',
    referenceDisplayWithCode: true,
  },
  {
    key: 'address',
    labelKey: 'importCenter.fields.address',
    label: 'Detailed Address',
    required: true,
    type: 'string',
  },
  {
    key: 'productSku',
    labelKey: 'importCenter.fields.productSku',
    label: 'Product',
    required: true,
    type: 'string',
    example: 'منتج اختبار',
    referenceType: 'PRODUCT',
    referenceMatchField: 'name',
  },
  {
    key: 'quantity',
    labelKey: 'importCenter.fields.quantity',
    label: 'Quantity',
    required: true,
    type: 'number',
    example: '1',
  },
  {
    key: 'paidAmount',
    labelKey: 'importCenter.fields.paidAmount',
    label: 'Paid Amount',
    required: true,
    type: 'number',
    example: '99.00',
  },
  {
    key: 'currencyCode',
    labelKey: 'importCenter.fields.currencyCode',
    label: 'Currency',
    required: true,
    type: 'string',
    example: 'SAR',
    referenceType: 'CURRENCY',
  },
  {
    key: 'paymentMethodLabel',
    labelKey: 'importCenter.fields.paymentMethodLabel',
    label: 'Payment Method',
    required: true,
    type: 'string',
    referenceType: 'PAYMENT_METHOD',
  },
  {
    key: 'receipt1',
    labelKey: 'importCenter.fields.receipt1',
    label: 'Receipt URL 1',
    required: false,
    type: 'string',
  },
  {
    key: 'receipt2',
    labelKey: 'importCenter.fields.receipt2',
    label: 'Receipt URL 2',
    required: false,
    type: 'string',
  },
  {
    key: 'receipt3',
    labelKey: 'importCenter.fields.receipt3',
    label: 'Receipt URL 3',
    required: false,
    type: 'string',
  },
  {
    key: 'notes',
    labelKey: 'importCenter.fields.notes',
    label: 'Notes',
    required: false,
    type: 'string',
  },
  {
    key: 'agentEmail',
    labelKey: 'importCenter.fields.agentEmail',
    label: 'Employee Email',
    required: true,
    type: 'string',
    referenceType: 'EMPLOYEE',
    referenceMatchField: 'code',
  },
];

interface LineItem {
  productId: string;
  quantity: number;
  unitPrice: number;
}

/**
 * Store Orders Import (Store Orders + Shipping Operations) — grouped by
 * `externalOrderId` (2026-08-14 revision): every row sharing the same
 * External Order ID is one product LINE of the same order, the same
 * "many rows, one document" shape `sales-orders-import.handler.ts` already
 * established (`groupKey`/`importGroup`) — never a second grouping
 * mechanism. Order-level fields (customer/country/address/currency/payment
 * method/employee/notes/receipts) are read from the group's first row only
 * and ignored on the rest, matching that same precedent exactly.
 *
 * `Paid Amount` is the actual amount charged for THAT line — never derived
 * from Product master data (Product intentionally carries no selling
 * price, ADR-0011) and never recalculated from Quantity. `unitPrice` on
 * the created `StoreOrderItem` (a required field the underlying schema
 * still needs) is mechanically `paidAmount / quantity` for that line —
 * this makes the order's real value equal to `SUM(quantity * unitPrice)`
 * across items, which equals `SUM(paidAmount)` across the file's rows for
 * that order, satisfying "Order Total = SUM(Paid Amount)" without a
 * separate total column.
 *
 * `Payment Method` and the per-order total `Paid Amount` are recorded as a
 * plain activity note (`StoreOrdersService.addNote`, exported by
 * `StoreOrdersModule` specifically for this handler) — informational only,
 * never a real `Payment` row. A real Payment needs a Payment Source +
 * Receiving Account + Sender Name this template intentionally doesn't
 * collect; guessing at those would risk incorrect accounting data. Actual
 * reconciliation happens later through the existing Cash Flow workflow —
 * same "never post from raw imported rows" rule that module already
 * follows.
 *
 * Phone matching (rule 2, unchanged) is the one genuinely ambiguous case:
 * when `CustomersService.lookupByPhone` already finds an existing
 * Customer, this handler NEVER silently attaches to it during the
 * automated pass — instead it throws `ImportRowNeedsReviewError` so the
 * row surfaces on the Import Center's Needs Review screen. This is only
 * safe for a single-line order: the review/confirm engine
 * (`ImportJobsService.confirmRow`) resolves ONE row at a time with no
 * visibility into sibling rows of the same group, so a multi-line order
 * whose customer needs review fails with a clear, actionable error instead
 * of risking one Order being silently split across several confirm calls.
 */
@Injectable()
export class StoreOrdersImportHandler
  implements ImportTypeHandler, OnModuleInit
{
  readonly type = 'STORE_ORDERS';
  readonly labelKey = 'importCenter.types.storeOrders.label';
  readonly descriptionKey = 'importCenter.types.storeOrders.description';
  readonly fields = FIELDS;
  readonly isAvailable = true;
  readonly groupKey = 'externalOrderId';
  /** Reserved sync write-back columns (2026-08-15) — must exactly match the column names `SyncOrchestratorService.writeBackStoreOrders`/`confirmRow`/`rejectRow` write to. */
  readonly resultColumns = ['Sync Status', 'System Order ID', 'Error Message'];

  constructor(
    private readonly prisma: PrismaService,
    private readonly customersService: CustomersService,
    private readonly countriesService: CountriesService,
    private readonly storeOrdersService: StoreOrdersService,
    private readonly phoneNumberService: PhoneNumberService,
    private readonly registry: ImportTypeRegistryService,
    private readonly referenceData: ReferenceDataRegistryService,
  ) {}

  onModuleInit() {
    this.registry.register(this);
  }

  importRow(
    row: Record<string, string>,
    userId?: string,
    options?: ImportRowOptions,
  ): Promise<ImportRowResult> {
    return this.importGroup([row], userId, options);
  }

  async importGroup(
    rows: Record<string, string>[],
    userId?: string,
    options?: ImportRowOptions,
  ): Promise<ImportRowResult> {
    const {
      first,
      countryId,
      normalizedPhone,
      currencyId,
      paymentMethodLabel,
      employeeId,
      orderDate,
      items,
      totalPaidAmount,
    } = await this.validateGroup(rows);

    const existingCustomer =
      await this.customersService.lookupByPhone(normalizedPhone);
    if (existingCustomer) {
      if (rows.length > 1) {
        throw new BadRequestException(
          `Existing customer found by phone (${existingCustomer.customerNumber} — ${existingCustomer.name}) on a multi-line order (External Order ID ${first.externalOrderId}) — attach the customer manually, since a multi-line order can't be split across individual review confirmations.`,
        );
      }
      throw new ImportRowNeedsReviewError(
        `Existing customer found by phone (${existingCustomer.customerNumber} — ${existingCustomer.name}) — confirm to attach.`,
      );
    }

    if (options?.dryRun) return { id: 'dry-run' };

    const order = await this.storeOrdersService.create(
      this.buildDto(
        first,
        currencyId,
        employeeId,
        countryId,
        normalizedPhone,
        orderDate,
        items,
      ),
      userId,
    );
    await this.recordImportedExtras(
      order.id,
      first,
      paymentMethodLabel,
      totalPaidAmount,
      userId,
    );
    return { id: order.id };
  }

  /** Called only after a human confirms a needs-review row — never re-checks the phone match, always writes for real. Only reachable for a single-line order (see class doc comment). */
  async resolveNeedsReview(
    row: Record<string, string>,
    userId?: string,
  ): Promise<ImportRowResult> {
    const {
      first,
      countryId,
      normalizedPhone,
      currencyId,
      paymentMethodLabel,
      employeeId,
      orderDate,
      items,
      totalPaidAmount,
    } = await this.validateGroup([row]);
    const order = await this.storeOrdersService.create(
      this.buildDto(
        first,
        currencyId,
        employeeId,
        countryId,
        normalizedPhone,
        orderDate,
        items,
      ),
      userId,
    );
    await this.recordImportedExtras(
      order.id,
      first,
      paymentMethodLabel,
      totalPaidAmount,
      userId,
    );
    return { id: order.id };
  }

  private buildDto(
    first: Record<string, string>,
    currencyId: string,
    employeeId: string,
    countryId: string,
    normalizedPhone: string,
    orderDate: string,
    items: LineItem[],
  ) {
    return {
      externalOrderId: first.externalOrderId,
      customer: {
        name: first.customerName,
        phone: normalizedPhone,
        countryId,
        address: first.address,
      },
      orderDate,
      source: StoreOrderSource.IMPORT,
      currencyId,
      employeeId,
      notes: first.notes || undefined,
      items,
    };
  }

  /** Payment Method + the order's real total (`SUM(Paid Amount)`) recorded as an audit-trail note — informational only, never a real Payment (see class doc comment). */
  private async recordImportedExtras(
    orderId: string,
    first: Record<string, string>,
    paymentMethodLabel: string,
    totalPaidAmount: number,
    userId?: string,
  ) {
    await this.storeOrdersService.addNote(
      orderId,
      {
        text: `Imported payment info — Payment Method: ${paymentMethodLabel}; Paid Amount: ${totalPaidAmount} ${first.currencyCode}`,
      },
      userId,
    );
    for (const url of [first.receipt1, first.receipt2, first.receipt3]) {
      if (!url?.trim()) continue;
      await this.storeOrdersService.addReceipt(
        orderId,
        { fileUrl: url.trim() },
        userId,
      );
    }
  }

  private async validateGroup(rows: Record<string, string>[]) {
    const first = rows[0];

    if (!first.externalOrderId?.trim()) {
      throw new BadRequestException('External Order ID is required.');
    }
    const existingOrder = await this.prisma.storeOrder.findFirst({
      where: { externalOrderId: first.externalOrderId, deletedAt: null },
    });
    if (existingOrder) {
      throw new BadRequestException({
        code: 'DUPLICATE',
        message: `A Store Order with external order id "${first.externalOrderId}" already exists (${existingOrder.internalOrderId}).`,
        fields: [{ field: 'externalOrderId', constraints: ['unique'] }],
      });
    }

    if (!first.customerName?.trim()) {
      throw new BadRequestException('Customer Name is required.');
    }
    if (!first.customerPhone?.trim()) {
      throw new BadRequestException('Phone is required.');
    }
    if (!first.address?.trim()) {
      throw new BadRequestException('Detailed Address is required.');
    }

    const orderDate = parseDate(first.orderDate, 'Order Date');

    const countryId = await this.resolveListSheetValue(
      'country',
      first.countryName,
      'Country',
    );
    // Phone normalization (spec: "the employee enters the phone WITHOUT the
    // international calling code... the system must use the SELECTED
    // Country's calling code to normalize/validate the phone internally,"
    // never a hardcoded "+966") — the exact same `PhoneNumberService`/
    // `defaultRegion` pattern `leads-import.handler.ts` already established,
    // reused unchanged, never a second phone-parsing mechanism.
    const country = await this.countriesService.findOne(countryId);
    const phoneCheck = this.phoneNumberService.parse(
      first.customerPhone,
      country.code,
    );
    if (!phoneCheck.isValid || !phoneCheck.e164) {
      throw new BadRequestException(phoneErrorMessage(phoneCheck.errorReason));
    }
    const normalizedPhone = phoneCheck.e164;
    const currencyId = await this.resolveListSheetValue(
      'currency',
      first.currencyCode,
      'Currency',
    );
    const paymentMethodId = await this.resolveListSheetValue(
      'paymentMethod',
      first.paymentMethodLabel,
      'Payment Method',
    );
    void paymentMethodId; // resolved only to validate — Payment Method has no FK column on StoreOrder (see class doc comment).
    const employeeId = await this.resolveListSheetValue(
      'employeeEmail',
      first.agentEmail,
      'Employee Email',
    );

    for (const url of [first.receipt1, first.receipt2, first.receipt3]) {
      if (url?.trim()) assertValidUrl(url.trim());
    }

    let totalPaidAmount = 0;
    const items: LineItem[] = [];
    for (const row of rows) {
      const productId = await this.resolveListSheetValue(
        'product',
        row.productSku,
        'Product',
      );
      const quantity = Number(row.quantity);
      if (!row.quantity || !Number.isInteger(quantity) || quantity < 1) {
        throw new BadRequestException(
          `Quantity must be a whole number of at least 1 (Product ${row.productSku || '?'}).`,
        );
      }
      const paidAmount = Number(row.paidAmount);
      if (
        row.paidAmount === undefined ||
        row.paidAmount === '' ||
        Number.isNaN(paidAmount) ||
        paidAmount < 0
      ) {
        throw new BadRequestException(
          `Paid Amount must be a non-negative number (Product ${row.productSku || '?'}).`,
        );
      }
      totalPaidAmount += paidAmount;
      items.push({ productId, quantity, unitPrice: paidAmount / quantity });
    }

    return {
      first,
      countryId,
      normalizedPhone,
      currencyId,
      paymentMethodLabel: first.paymentMethodLabel,
      employeeId,
      orderDate,
      items,
      totalPaidAmount,
    };
  }

  /**
   * Resolves a Google Sheets cell using the same display field List Sheet
   * publishes — Product name, Country name, Currency code, etc.
   */
  private resolveListSheetValue(
    key: ListSheetColumnKey,
    value: string | undefined,
    label: string,
  ): Promise<string> {
    const match = listSheetReferenceMatch(key);
    if (!match) {
      throw new BadRequestException(`${label} is not a List Sheet reference.`);
    }
    return this.referenceData.resolveRequired(
      match.type,
      match.matchField,
      value,
      label,
    );
  }
}

function parseDate(value: string | undefined, label: string): string {
  const trimmed = value?.trim();
  if (!trimmed) {
    throw new BadRequestException(`${label} is required.`);
  }
  const parsed = new Date(trimmed);
  if (Number.isNaN(parsed.getTime())) {
    throw new BadRequestException(`${label} "${trimmed}" is not a valid date.`);
  }
  return parsed.toISOString();
}

function assertValidUrl(value: string) {
  try {
    new URL(value);
  } catch {
    throw new BadRequestException(`"${value}" is not a valid URL.`);
  }
}
