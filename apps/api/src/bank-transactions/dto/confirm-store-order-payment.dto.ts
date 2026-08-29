import { IsBoolean, IsOptional, IsString, IsUUID } from 'class-validator';

export class ConfirmStoreOrderPaymentDto {
  @IsUUID()
  storeOrderId!: string;

  @IsUUID()
  paymentSourceId!: string;

  @IsString()
  @IsOptional()
  referenceNumber?: string;

  @IsString()
  @IsOptional()
  senderName?: string;

  /** Required when UI detected method mismatch — records authorized override. */
  @IsBoolean()
  @IsOptional()
  acknowledgeMethodMismatch?: boolean;

  /** When true, use selected paymentSourceId as the authoritative HOW for this match. */
  @IsBoolean()
  @IsOptional()
  updateExpectedPaymentSource?: boolean;
}
