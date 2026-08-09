import {
  ArrayMinSize,
  IsArray,
  IsOptional,
  IsString,
  IsUUID,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { PurchaseLineItemInputDto } from '../../shared/purchase-line-item-input.dto';

/**
 * TASK-048 — a Purchase Return must always originate from an existing
 * Purchase Invoice (no standalone/empty returns): `purchaseInvoiceId` is
 * required here, and the service layer additionally requires every line's
 * `purchaseInvoiceItemId` and cross-checks it against this invoice.
 */
export class CreatePurchaseReturnDto {
  @IsUUID()
  supplierId!: string;

  @IsUUID()
  purchaseInvoiceId!: string;

  @IsUUID()
  @IsOptional()
  currencyId?: string;

  @IsString()
  @IsOptional()
  referenceNumber?: string;

  @IsString()
  @IsOptional()
  internalNotes?: string;

  @IsString()
  @IsOptional()
  supplierNotes?: string;

  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => PurchaseLineItemInputDto)
  items!: PurchaseLineItemInputDto[];
}
