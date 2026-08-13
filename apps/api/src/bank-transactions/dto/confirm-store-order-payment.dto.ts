import { IsOptional, IsString, IsUUID } from 'class-validator';

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
}
