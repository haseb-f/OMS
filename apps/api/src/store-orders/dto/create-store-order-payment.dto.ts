import { Transform } from 'class-transformer';
import {
  IsDateString,
  IsNotEmpty,
  IsOptional,
  IsPositive,
  IsString,
  IsUUID,
} from 'class-validator';
import { emptyToUndefined } from '../../common/transforms/empty-to-undefined';

/**
 * Same shape as `CreatePaymentDto` minus `leadId`/`storeOrderId` — the
 * caller (StoreOrdersService) sets `storeOrderId` itself; `leadId` is never
 * applicable here (a Payment belongs to at most one of the two). Used both
 * for the optional first payment on `POST /store-orders` and for
 * `POST /store-orders/:id/payments` (adding further partial payments to an
 * already-created order).
 */
export class CreateStoreOrderPaymentDto {
  @IsDateString()
  paymentDate!: string;

  @IsDateString()
  @IsOptional()
  receivedDate?: string;

  @IsPositive()
  amount!: number;

  /** Defaults to the Store Order's own currency when omitted. */
  @IsUUID()
  @IsOptional()
  currencyId?: string;

  @IsUUID()
  paymentSourceId!: string;

  @IsUUID()
  receivingAccountId!: string;

  @Transform(emptyToUndefined)
  @IsString()
  @IsOptional()
  referenceNumber?: string;

  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  @IsString()
  @IsNotEmpty()
  senderName!: string;

  @Transform(emptyToUndefined)
  @IsString()
  @IsOptional()
  bankAccount?: string;
}
