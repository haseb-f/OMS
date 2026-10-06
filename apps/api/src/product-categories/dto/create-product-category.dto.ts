import { IsNotEmpty, IsOptional, IsString } from 'class-validator';
import { IsOptionalUuid } from '../../common/decorators/is-optional-uuid.decorator';

/** Account-mapping fields are TASK-047 (Accounting Configuration) — optional overrides of the Accounting Settings defaults. */
export class CreateProductCategoryDto {
  @IsString()
  @IsNotEmpty()
  name!: string;

  @IsString()
  @IsOptional()
  description?: string;

  @IsOptionalUuid()
  revenueAccountId?: string;

  @IsOptionalUuid()
  inventoryAccountId?: string;

  @IsOptionalUuid()
  cogsAccountId?: string;

  @IsOptionalUuid()
  purchaseAccountId?: string;

  /** R13 — pre-filled on a new product of this category (the product form shows where the value came from). */
  @IsOptionalUuid()
  defaultUnitId?: string;

  @IsOptionalUuid()
  defaultTaxId?: string;
}
