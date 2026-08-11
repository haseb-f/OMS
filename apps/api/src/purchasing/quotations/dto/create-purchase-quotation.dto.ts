import {
  ArrayMinSize,
  IsArray,
  IsDateString,
  IsEnum,
  IsOptional,
  IsString,
  IsUUID,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { PurchaseType } from '@prisma/client';
import { PurchaseLineItemInputDto } from '../../shared/purchase-line-item-input.dto';
import { IsOptionalUuid } from '../../../common/decorators/is-optional-uuid.decorator';

export class CreatePurchaseQuotationDto {
  @IsUUID()
  supplierId!: string;

  @IsOptionalUuid()
  currencyId?: string;

  @IsEnum(PurchaseType)
  purchaseType!: PurchaseType;

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
  supplierNotes?: string;

  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => PurchaseLineItemInputDto)
  items!: PurchaseLineItemInputDto[];
}
