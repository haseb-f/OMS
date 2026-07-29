import {
  IsDateString,
  IsNotEmpty,
  IsOptional,
  IsPositive,
  IsString,
  IsUUID,
} from 'class-validator';

/**
 * paymentNumber is auto-generated (own sequence, mirrors Lead/SalesOrder) —
 * not a client input. Payment.leadId is optional (RELATIONS: "Payment ->
 * Lead (Optional)").
 */
export class CreatePaymentDto {
  @IsUUID()
  @IsOptional()
  leadId?: string;

  @IsDateString()
  paymentDate!: string;

  @IsDateString()
  @IsOptional()
  receivedDate?: string;

  @IsPositive()
  amount!: number;

  @IsUUID()
  currencyId!: string;

  /** How the customer paid. */
  @IsUUID()
  paymentSourceId!: string;

  /** Where the money actually arrived — required alongside paymentSourceId, never only one. */
  @IsUUID()
  receivingAccountId!: string;

  /** Optional — not every payment source produces a formal reference number. */
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
