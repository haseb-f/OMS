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
import { IsOptionalUuid } from '../../../common/decorators/is-optional-uuid.decorator';

/** Direct/standalone Goods Receipt — no originating Purchase Order. Warehouse is required on every line. */
export class CreatePurchaseInvoiceDto {
  @IsUUID()
  partnerId!: string;

  @IsOptionalUuid()
  currencyId?: string;

  /** TASK-051 Document Context Enrichment — optional cost attribution, never required. */
  @IsOptionalUuid()
  costCenterId?: string;

  @IsOptionalUuid()
  projectId?: string;

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
