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
 * Sales Foundation (TASK-037) — the line-item shape shared by all four
 * Sales documents. `warehouseId` is optional here at the DTO level and
 * enforced as required in the service layer for Order/Invoice/Return only
 * (a Quotation commits nothing) — same "conditionally required, validated
 * in the service because it depends on other state" pattern ADR-0012 uses
 * for Product's dimension fields, since neither Postgres NOT NULL nor
 * class-validator can express a per-document-type condition declaratively.
 */
export class SalesLineItemInputDto {
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

  /** Sales Return lines — links back to the invoice line being reversed,
   * capping returned quantity at invoiced-minus-already-returned. Sales
   * Invoice edit — the existing line this one replaces, so a line created
   * from a Sales Order keeps its order link. Ignored by Quotations / Orders. */
  @IsUUID()
  @IsOptional()
  salesInvoiceItemId?: string;
}
