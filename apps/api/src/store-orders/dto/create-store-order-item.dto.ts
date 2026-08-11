import { IsInt, IsNumber, IsPositive, IsUUID, Min } from 'class-validator';

/**
 * Pricing snapshot per line (mirrors the legacy OrderItem/SalesOrderDocumentItem
 * precedent) — `unitPrice` is caller-supplied and stored as-is, never
 * re-derived from the Product's live price afterward.
 */
export class CreateStoreOrderItemDto {
  @IsUUID()
  productId!: string;

  @IsInt()
  @IsPositive()
  quantity!: number;

  @IsNumber()
  @Min(0)
  unitPrice!: number;
}
