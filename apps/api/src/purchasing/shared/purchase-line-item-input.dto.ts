import { DepreciationMethod, PurchaseLineTreatment } from '@prisma/client';
import {
  IsDateString,
  IsEnum,
  IsInt,
  IsNumber,
  IsOptional,
  IsPositive,
  IsString,
  IsUUID,
  Min,
} from 'class-validator';
import { IsOptionalUuid } from '../../common/decorators/is-optional-uuid.decorator';

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

  /** Purchase Invoice only — capitalize as a Fixed Asset or defer as a
   *  Prepaid Expense instead of the standard inventory/expense posting. */
  @IsEnum(PurchaseLineTreatment)
  @IsOptional()
  treatment?: PurchaseLineTreatment;

  @IsInt()
  @Min(1)
  @IsOptional()
  assetUsefulLifeMonths?: number;

  @IsEnum(DepreciationMethod)
  @IsOptional()
  assetDepreciationMethod?: DepreciationMethod;

  @IsDateString()
  @IsOptional()
  scheduleStartDate?: string;

  @IsInt()
  @Min(1)
  @IsOptional()
  prepaidMonths?: number;

  @IsOptionalUuid()
  prepaidExpenseAccountId?: string;
}
