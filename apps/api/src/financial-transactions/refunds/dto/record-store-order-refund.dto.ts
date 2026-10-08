import {
  IsDateString,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsPositive,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
} from 'class-validator';
import { IsOptionalUuid } from '../../../common/decorators/is-optional-uuid.decorator';

/**
 * R15 (D15-11) — "Record refund" on a store order: money already returned
 * to the customer (no payment-gateway integration exists — the refund is
 * paid through the gateway / bank first and recorded here). The server
 * splits the amount over the order's credit notes (oldest first) and its
 * advance; the client never chooses the allocation.
 */
export class RecordStoreOrderRefundDto {
  @IsNumber({ maxDecimalPlaces: 2 })
  @IsPositive()
  amount!: number;

  /** The Cash / Bank account the money was paid out of (posting credits it). */
  @IsUUID()
  receivingAccountId!: string;

  @IsOptionalUuid()
  paymentSourceId?: string;

  /** Defaults to now. */
  @IsDateString()
  @IsOptional()
  transactionDate?: string;

  /** Gateway / bank transfer reference of the refund. */
  @IsString()
  @IsOptional()
  @MaxLength(120)
  referenceNumber?: string;

  @IsString()
  @IsOptional()
  @MaxLength(1000)
  notes?: string;

  /** One key per opened dialog — a retried submit returns the first refund. */
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  @Matches(/^[A-Za-z0-9_-]+$/, {
    message: 'idempotencyKey may contain only letters, digits, "-" and "_".',
  })
  idempotencyKey!: string;
}
