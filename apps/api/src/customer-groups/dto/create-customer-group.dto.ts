import { IsNotEmpty, IsOptional, IsString, IsUUID } from 'class-validator';

/** Account-mapping fields are TASK-047 (Accounting Configuration) — optional overrides of the Accounting Settings defaults. */
export class CreateCustomerGroupDto {
  @IsString()
  @IsNotEmpty()
  code!: string;

  @IsString()
  @IsNotEmpty()
  name!: string;

  @IsString()
  @IsOptional()
  description?: string;

  @IsUUID()
  @IsOptional()
  defaultReceivableAccountId?: string;

  @IsUUID()
  @IsOptional()
  defaultRevenueAccountId?: string;
}
