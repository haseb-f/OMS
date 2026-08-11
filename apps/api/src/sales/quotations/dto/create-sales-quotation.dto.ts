import {
  ArrayMinSize,
  IsArray,
  IsDateString,
  IsOptional,
  IsString,
  IsUUID,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { SalesLineItemInputDto } from '../../shared/sales-line-item-input.dto';
import { IsOptionalUuid } from '../../../common/decorators/is-optional-uuid.decorator';

export class CreateSalesQuotationDto {
  @IsUUID()
  customerId!: string;

  @IsOptionalUuid()
  currencyId?: string;

  /** Defaults to "now" in the service when omitted. */
  @IsDateString()
  @IsOptional()
  documentDate?: string;

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
