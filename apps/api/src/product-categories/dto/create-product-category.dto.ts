import { IsNotEmpty, IsOptional, IsString, IsUUID } from 'class-validator';

/** Account-mapping fields are TASK-047 (Accounting Configuration) — optional overrides of the Accounting Settings defaults. */
export class CreateProductCategoryDto {
  @IsString()
  @IsNotEmpty()
  name!: string;

  @IsString()
  @IsOptional()
  description?: string;

  @IsUUID()
  @IsOptional()
  revenueAccountId?: string;

  @IsUUID()
  @IsOptional()
  inventoryAccountId?: string;

  @IsUUID()
  @IsOptional()
  cogsAccountId?: string;

  @IsUUID()
  @IsOptional()
  purchaseAccountId?: string;
}
