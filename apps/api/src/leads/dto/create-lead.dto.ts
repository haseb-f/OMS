import { Transform } from 'class-transformer';
import {
  IsEnum,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Min,
} from 'class-validator';
import { LeadSource } from '@prisma/client';
import { IsOptionalUuid } from '../../common/decorators/is-optional-uuid.decorator';

/** A UI form's untouched "no selection" Select value — normalized to `undefined` so `@IsOptional()` actually skips validation for it (an empty string is not `null`/`undefined`, so it would otherwise still be checked against `@IsUUID()`/`@IsString()`). */
const emptyToUndefined = ({ value }: { value: unknown }) =>
  value === '' ? undefined : value;

/** Input-only discriminator — never stored on `Lead` itself. Decides which
 * tier of validation `LeadsService.create()` applies: a Lead needs only
 * name/phone/country; an Order additionally needs address/product/paid
 * amount (enforced in the service, not here, since it depends on more than
 * one field together). */
export type LeadRecordType = 'LEAD' | 'ORDER';

export class CreateLeadDto {
  @IsString()
  @IsNotEmpty()
  customerName!: string;

  /**
   * Any common representation (local "0501234567", international
   * "+966501234567", or "00966501234567") — `PhoneNumberService` in
   * `LeadsService.create()` parses this against `countryId`'s ISO2 code and
   * rejects/normalizes it there, where country context is available. A bare
   * `@IsPhoneNumber()` here would wrongly reject valid local-format input.
   */
  @IsString()
  @IsNotEmpty()
  mobileNumber!: string;

  @IsUUID()
  countryId!: string;

  /** `'LEAD'` (default) or `'ORDER'` — see `LeadRecordType`. */
  @IsIn(['LEAD', 'ORDER'])
  @IsOptional()
  recordType?: LeadRecordType;

  /** Optional at the Lead stage — required only for `recordType: 'ORDER'`, enforced in `LeadsService.assertOrderReady()`. */
  @IsString()
  @IsOptional()
  city?: string;

  @IsString()
  @IsOptional()
  address?: string;

  /** A real reference to the Product catalog — required only for `recordType: 'ORDER'`. */
  @IsOptionalUuid()
  productId?: string;

  /** Optional — defaults to 1 server-side when omitted. */
  @IsInt()
  @Min(1)
  @IsOptional()
  quantity?: number;

  /** Optional — defaults from the selected country's `defaultCurrencyId` (falling back to the system's first active currency) when omitted. */
  @IsOptionalUuid()
  currencyId?: string;

  @IsEnum(LeadSource)
  source!: LeadSource;

  @Transform(emptyToUndefined)
  @IsOptionalUuid()
  salesEmployeeId?: string;

  @IsString()
  @IsOptional()
  importBatch?: string;

  /** The source system's own order identifier — used to detect a re-imported duplicate order (see LeadsService.create). */
  @Transform(emptyToUndefined)
  @IsString()
  @IsOptional()
  externalOrderId?: string;

  // --- Order mode only (recordType: 'ORDER') ------------------------------

  /** Required for Order mode — creates a linked Payment record alongside the Lead in the same transaction. Never stored on Lead itself. */
  @IsNumber()
  @Min(0)
  @IsOptional()
  paidAmount?: number;

  /** Optional override — defaults to the PaymentSource flagged `isDefault` (or the first active one) when omitted, so Order mode never forces the user to pick one. */
  @IsOptionalUuid()
  paymentSourceId?: string;

  /** Optional override — same default behavior as `paymentSourceId`. */
  @IsOptionalUuid()
  receivingAccountId?: string;
}
