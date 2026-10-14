import { OmitType, PartialType } from '@nestjs/mapped-types';
import {
  IsDateString,
  IsEmpty,
  IsIn,
  IsNumber,
  IsOptional,
  IsPositive,
  IsString,
  IsUUID,
  MaxLength,
} from 'class-validator';
import { IsIdempotencyKey } from '../../shared/idempotency-key';
import { IsOptionalUuid } from '../../../common/decorators/is-optional-uuid.decorator';
import { IsOptionalUuidList } from '../../../common/query/enum-list';
import { FindFinancialTransactionsQueryDto } from '../../shared/find-financial-transactions-query.dto';

const NO_ALLOCATION =
  'This voucher never settles an invoice — record invoice settlements with a Customer Receipt or Supplier Payment.';

/** Fields every D4 voucher shares (amount, date, money route, dimensions, texts). */
class OtherVoucherBaseDto {
  @IsOptionalUuid()
  currencyId?: string;

  @IsOptionalUuid()
  costCenterId?: string;

  @IsOptionalUuid()
  projectId?: string;

  /** The voucher date — the entry is posted on it (D1). Defaults to now. */
  @IsDateString()
  @IsOptional()
  transactionDate?: string;

  @IsOptionalUuid()
  paymentSourceId?: string;

  @IsNumber()
  @IsPositive()
  amount!: number;

  @IsString()
  @IsOptional()
  referenceNumber?: string;

  /** What the money is for — shown on the voucher and the journal line. */
  @IsString()
  @MaxLength(500)
  @IsOptional()
  description?: string;

  @IsString()
  @IsOptional()
  notes?: string;

  /** Refused explicitly (the global pipe would otherwise strip it silently). */
  @IsEmpty({ message: NO_ALLOCATION })
  allocations?: never;

  /** One key per opened form — a repeated submit returns the first document. */
  @IsIdempotencyKey()
  idempotencyKey?: string;
}

/**
 * R22 (D4) — Other Receipt (تحصيل آخر) / Other Payment (صرف آخر): money in
 * or out against an authorised counter-account (`GET
 * financial-transactions/counter-accounts?direction=IN|OUT`). No party and
 * no invoice allocation. `receivingAccountId` = the cash / bank account the
 * money enters / leaves (required to confirm).
 */
export class CreateCounterVoucherDto extends OtherVoucherBaseDto {
  @IsUUID()
  counterAccountId!: string;

  @IsOptionalUuid()
  receivingAccountId?: string;
}

/** Draft edit. `null` clears cost centre / project. */
export class UpdateCounterVoucherDto extends PartialType(
  OmitType(CreateCounterVoucherDto, [
    'idempotencyKey',
    'costCenterId',
    'projectId',
  ] as const),
) {
  @IsOptionalUuid()
  costCenterId?: string | null;

  @IsOptionalUuid()
  projectId?: string | null;
}

/**
 * R22 (D4) — Internal Transfer (تحويل بين الحسابات): from
 * `receivingAccountId` (source) to `targetReceivingAccountId` (destination),
 * two different cash / bank accounts in one currency (another currency is a
 * 422 TRANSFER_CROSS_CURRENCY). Dr destination / Cr source.
 */
export class CreateTransferDto extends OtherVoucherBaseDto {
  @IsUUID()
  receivingAccountId!: string;

  @IsUUID()
  targetReceivingAccountId!: string;
}

/** Draft edit. `null` clears cost centre / project. */
export class UpdateTransferDto extends PartialType(
  OmitType(CreateTransferDto, [
    'idempotencyKey',
    'costCenterId',
    'projectId',
  ] as const),
) {
  @IsOptionalUuid()
  costCenterId?: string | null;

  @IsOptionalUuid()
  projectId?: string | null;
}

/** List: status / date range / search / the cash-bank account(s) (source for a transfer). */
export class FindOtherVouchersQueryDto extends FindFinancialTransactionsQueryDto {
  @IsOptionalUuidList()
  receivingAccountId?: string[];
}

export class CounterAccountsQueryDto {
  @IsIn(['IN', 'OUT'])
  direction!: 'IN' | 'OUT';
}
