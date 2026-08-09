import {
  IsInt,
  IsNumber,
  IsOptional,
  IsPositive,
  IsString,
  IsUUID,
  Min,
} from 'class-validator';

/**
 * Purchasing (TASK-048) — the line-item shape shared by the three new
 * Purchasing documents (Quotation/Invoice/Return), mirroring
 * `SalesLineItemInputDto` field-for-field. `warehouseId` is optional here at
 * the DTO level and enforced as required in the service layer for
 * Invoice/Return only (Quotation commits nothing, matching PurchaseOrderItem
 * having no warehouse column at all) — same "conditionally required,
 * validated in the service" pattern SalesLineItemInputDto uses.
 */
export class PurchaseLineItemInputDto {
  @IsUUID()
  productId!: string;

  @IsString()
  @IsOptional()
  description?: string;

  @IsUUID()
  @IsOptional()
  warehouseId?: string;

  @IsUUID()
  unitId!: string;

  @IsInt()
  @IsPositive()
  quantity!: number;

  @IsNumber()
  @Min(0)
  unitPrice!: number;

  @IsNumber()
  @Min(0)
  @IsOptional()
  discountPercent?: number;

  @IsNumber()
  @Min(0)
  @IsOptional()
  discountValue?: number;

  @IsUUID()
  @IsOptional()
  taxId?: string;

  @IsString()
  @IsOptional()
  notes?: string;

  /** Purchase Return lines only — links back to the invoice line being
   * reversed, capping returned quantity at received-minus-already-returned.
   * Unused (ignored) by Quotation/Invoice. */
  @IsUUID()
  @IsOptional()
  purchaseInvoiceItemId?: string;
}
