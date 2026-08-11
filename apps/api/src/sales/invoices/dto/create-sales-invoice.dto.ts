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
import { IsOptionalUuid } from '../../../common/decorators/is-optional-uuid.decorator';

/** Direct/standalone invoice — no originating Sales Order. Warehouse is required on every line. */
export class CreateSalesInvoiceDto {
  @IsUUID()
  customerId!: string;

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
  customerNotes?: string;

  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => SalesLineItemInputDto)
  items!: SalesLineItemInputDto[];
}
