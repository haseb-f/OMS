import { IsNumber, IsPositive, IsUUID, ValidateIf } from 'class-validator';

/**
 * One Customer Refund line: it pays back EITHER the unrefunded credit of a
 * posted Sales Return (`invoiceId` = the return id, the generic allocation
 * field) OR — R15 (D15-11) — the verified, not-invoiced advance of a store
 * order (`storeOrderId`: a cancelled / undelivered prepaid order or an
 * overpayment). Exactly one of the two per line; the service enforces it and
 * every cap, never the client.
 */
export class RefundAllocationInputDto {
  @ValidateIf((line: RefundAllocationInputDto) => !line.storeOrderId)
  @IsUUID()
  invoiceId?: string;

  @ValidateIf(
    (line: RefundAllocationInputDto) => line.storeOrderId !== undefined,
  )
  @IsUUID()
  storeOrderId?: string;

  @IsNumber()
  @IsPositive()
  allocatedAmount!: number;
}
