import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsDateString,
  IsEnum,
  IsOptional,
  IsString,
  IsUUID,
  ValidateNested,
} from 'class-validator';
import { PurchaseType } from '@prisma/client';
import { PurchaseOrderItemInputDto } from './purchase-order-item-input.dto';
import { IsOptionalUuid } from '../../common/decorators/is-optional-uuid.decorator';

/**
 * "Purchase Order is only an agreement to buy." Preparation-For-Future
 * placeholders (Receiving Warehouse, Price List, Incoterms, Buyer, Shipping
 * Method, Expected Receipt Date) are schema-only — not accepted here, per
 * "DO NOT implement business logic."
 */
export class CreatePurchaseOrderDto {
  @IsUUID()
  supplierId!: string;

  /** Set internally when a PO is created via "Convert to Order" (TASK-048) — never accepted from a plain create-PO request body. */
  @IsOptionalUuid()
  quotationId?: string;

  @IsOptionalUuid()
  projectId?: string;

  @IsOptionalUuid()
  costCenterId?: string;

  @IsOptionalUuid()
  currencyId?: string;

  @IsEnum(PurchaseType)
  purchaseType!: PurchaseType;

  @IsDateString()
  @IsOptional()
  expectedDeliveryDate?: string;

  @IsString()
  @IsOptional()
  referenceNumber?: string;

  @IsString()
  @IsOptional()
  internalNotes?: string;

  @IsString()
  @IsOptional()
  supplierNotes?: string;

  @ValidateNested({ each: true })
  @Type(() => PurchaseOrderItemInputDto)
  @ArrayMinSize(1)
  items!: PurchaseOrderItemInputDto[];
}
