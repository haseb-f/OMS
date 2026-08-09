import {
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Min,
} from 'class-validator';
import { BaseQuantityMovementDto } from './base-quantity-movement.dto';

/**
 * Purchasing (TASK-048) — posted when a Purchase Invoice (Goods Receipt) is
 * confirmed. Mirrors `PostSalesReturnDto` (both increase on-hand stock);
 * the reference is required so a `PURCHASE_RECEIPT` movement is always
 * traceable back to the invoice that caused it.
 */
export class PostPurchaseReceiptDto extends BaseQuantityMovementDto {
  @IsString()
  @IsNotEmpty()
  referenceType!: string;

  @IsUUID()
  referenceId!: string;

  /** TASK-057 — the invoice line's unit price; recomputes the product's moving-average cost. Optional so non-costed receipts (e.g. a future non-invoice source) still work. */
  @IsNumber()
  @Min(0)
  @IsOptional()
  unitCost?: number;
}
