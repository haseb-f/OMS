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
  @ValidateIf(
    (line: RefundAllocationInputDto) => !line.storeOrderId && !line.receiptId,
  )
  @IsUUID()
  invoiceId?: string;

  /**
   * R22 (D4) — OR the confirmed Customer Receipt whose unapplied amount
   * (advance / overpayment) this line pays back (`GET
   * financial-transactions/refunds/open-receipts?partnerId=`).
   */
  @ValidateIf((line: RefundAllocationInputDto) => line.receiptId !== undefined)
  @IsUUID()
  receiptId?: string;

  @ValidateIf(
    (line: RefundAllocationInputDto) => line.storeOrderId !== undefined,
  )
  @IsUUID()
  storeOrderId?: string;

  @IsNumber()
  @IsPositive()
  allocatedAmount!: number;
}
