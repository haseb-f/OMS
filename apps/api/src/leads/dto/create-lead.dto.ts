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

/** Leads are CRM prospects only. Operational orders use StoreOrder.
 * `ORDER` is rejected by `LeadsService.create()`. */
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

  /** Ignored except to reject retired Lead-as-Order (`ORDER`). */
  @IsIn(['LEAD', 'ORDER'])
  @IsOptional()
  recordType?: LeadRecordType;

  @IsString()
  @IsOptional()
  city?: string;

  @IsString()
  @IsOptional()
  address?: string;

  /** Optional — used later at conversion, not required to create a Lead. */
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

  /** Legacy import field — ignored. Payment belongs on StoreOrder. */
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

  @IsOptionalUuid()
  customerClassificationId?: string;
}
