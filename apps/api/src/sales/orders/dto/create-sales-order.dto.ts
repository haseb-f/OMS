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

/** Warehouse is required on every line here (unlike Quotation) — enforced in the service. */
export class CreateSalesOrderDto {
  @IsUUID()
  customerId!: string;

  @IsOptionalUuid()
  currencyId?: string;

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
