import {
  IsDateString,
  IsEmpty,
  IsNumber,
  IsOptional,
  IsPositive,
  IsString,
  IsUUID,
  MaxLength,
} from 'class-validator';
import { IsIdempotencyKey } from '../../shared/idempotency-key';
import { IsOptionalUuid } from '../../../common/decorators/is-optional-uuid.decorator';

/**
 * Expense voucher (R13 owner decision 2 — the Expenses screen): the account
 * debited is `expenseAccountId` (an EXPENSE posting account). `partnerId` is
 * an optional supplier counterparty — metadata only, never AP. No
 * `allocations`: an expense voucher never settles an invoice.
 */
export class CreateExpensePaymentDto {
  @IsUUID()
  expenseAccountId!: string;

  /** Optional supplier counterparty (who was paid). */
  @IsOptionalUuid()
  partnerId?: string;

  @IsOptionalUuid()
  currencyId?: string;

  @IsOptionalUuid()
  costCenterId?: string;

  @IsOptionalUuid()
  projectId?: string;

  /** Defaults to "now" in the service when omitted. */
  @IsDateString()
  @IsOptional()
  transactionDate?: string;

  @IsOptionalUuid()
  paymentSourceId?: string;

  @IsOptionalUuid()
  receivingAccountId?: string;

  @IsNumber()
  @IsPositive()
  amount!: number;

  @IsString()
  @IsOptional()
  referenceNumber?: string;

  /** What was spent — shown on the voucher and the journal line. */
  @IsString()
  @MaxLength(500)
  @IsOptional()
  description?: string;

  @IsString()
  @IsOptional()
  notes?: string;

  /** Refused explicitly (the global pipe would otherwise strip it silently). */
  @IsEmpty({
    message:
      'An expense voucher never settles an invoice — pay a supplier invoice with a Supplier Payment instead.',
  })
  allocations?: never;

  /** One key per opened form — a repeated submit returns the first document. */
  @IsIdempotencyKey()
  idempotencyKey?: string;
}
