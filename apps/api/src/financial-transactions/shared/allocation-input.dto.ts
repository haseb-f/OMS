import { IsNumber, IsPositive, IsUUID } from 'class-validator';

/**
 * One allocation line — shared by the create/update payload's `allocations`
 * array and the standalone "Allocate" endpoint. `invoiceId` targets
 * whichever invoice table the parent transaction's `type` implies
 * (SalesInvoice for CUSTOMER_RECEIPT, PurchaseInvoice for SUPPLIER_PAYMENT)
 * — resolved and validated in the service layer, never trusted from the
 * client.
 */
export class AllocationInputDto {
  @IsUUID()
  invoiceId!: string;

  @IsNumber()
  @IsPositive()
  allocatedAmount!: number;
}
