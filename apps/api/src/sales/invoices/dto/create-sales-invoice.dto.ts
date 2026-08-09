import {
  ArrayMinSize,
  IsArray,
  IsOptional,
  IsString,
  IsUUID,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { SalesLineItemInputDto } from '../../shared/sales-line-item-input.dto';

/** Direct/standalone invoice — no originating Sales Order. Warehouse is required on every line. */
export class CreateSalesInvoiceDto {
  @IsUUID()
  customerId!: string;

  @IsUUID()
  @IsOptional()
  currencyId?: string;

  /** TASK-051 Document Context Enrichment — optional cost attribution, never required. */
  @IsUUID()
  @IsOptional()
  costCenterId?: string;

  @IsUUID()
  @IsOptional()
  projectId?: string;

  @IsString()
  @IsOptional()
  referenceNumber?: string;

  @IsString()
  @IsOptional()
  internalNotes?: string;

  @IsString()
  @IsOptional()
  customerNotes?: string;

  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => SalesLineItemInputDto)
  items!: SalesLineItemInputDto[];
}
