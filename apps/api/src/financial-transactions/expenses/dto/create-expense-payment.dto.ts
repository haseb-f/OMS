import {
  IsDateString,
  IsNumber,
  IsOptional,
  IsPositive,
  IsString,
  IsUUID,
} from 'class-validator';
import { IsIdempotencyKey } from '../../shared/idempotency-key';
import { IsOptionalUuid } from '../../../common/decorators/is-optional-uuid.decorator';

/** No `allocations`/`customerId`/`supplierId` — an Expense Payment Voucher has no party and never settles an invoice, only `expenseAccountId` (required) instead. */
export class CreateExpensePaymentDto {
  @IsUUID()
  expenseAccountId!: string;

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

  @IsString()
  @IsOptional()
  notes?: string;

  /** One key per opened form — a repeated submit returns the first document. */
  @IsIdempotencyKey()
  idempotencyKey?: string;
}
