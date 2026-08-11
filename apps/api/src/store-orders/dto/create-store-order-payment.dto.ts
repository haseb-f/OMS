import {
  IsDateString,
  IsNotEmpty,
  IsOptional,
  IsPositive,
  IsString,
  IsUUID,
} from 'class-validator';

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

  @IsString()
  @IsNotEmpty()
  @IsOptional()
  referenceNumber?: string;

  @IsString()
  @IsNotEmpty()
  senderName!: string;

  @IsString()
  @IsOptional()
  bankAccount?: string;
}
