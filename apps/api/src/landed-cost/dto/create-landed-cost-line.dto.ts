import {
  IsNumber,
  IsOptional,
  IsPositive,
  IsString,
  IsUUID,
} from 'class-validator';

export class CreateLandedCostLineDto {
  @IsUUID()
  costComponentId!: string;

  @IsString()
  @IsOptional()
  description?: string;

  /** Net of VAT — the amount actually eligible for capitalization. */
  @IsNumber()
  @IsPositive()
  netAmount!: number;

  @IsUUID()
  @IsOptional()
  taxId?: string;
}
