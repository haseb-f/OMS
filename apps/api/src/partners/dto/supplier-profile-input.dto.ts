import {
  IsBoolean,
  IsNumber,
  IsOptional,
  IsString,
  Min,
} from 'class-validator';
import { IsOptionalUuid } from '../../common/decorators/is-optional-uuid.decorator';

/** SUPPLIER-role configuration only — sent alongside CreatePartnerDto/UpdatePartnerDto when `roles` includes SUPPLIER. */
export class SupplierProfileInputDto {
  @IsOptionalUuid()
  supplierGroupId?: string;

  /** No closed set of values specified — free-text (matches the former Supplier.paymentTerm). */
  @IsString()
  @IsOptional()
  paymentTerm?: string;

  @IsNumber()
  @Min(0)
  @IsOptional()
  creditLimit?: number;

  @IsBoolean()
  @IsOptional()
  isPreferred?: boolean;
}
