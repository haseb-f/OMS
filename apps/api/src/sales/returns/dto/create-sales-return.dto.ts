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

/**
 * TASK-048 — a Sales Return must always originate from an existing Sales
 * Invoice (no standalone/empty returns): `salesInvoiceId` is required here,
 * and the service layer additionally requires every line's
 * `salesInvoiceItemId` and cross-checks it against this invoice. Warehouse
 * is required on every line.
 */
export class CreateSalesReturnDto {
  @IsUUID()
  partnerId!: string;

  @IsUUID()
  salesInvoiceId!: string;

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
