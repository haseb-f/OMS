import {
  IsBoolean,
  IsEnum,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  Min,
} from 'class-validator';
import { CostAccountingClass } from '@prisma/client';

export class CreateCostComponentDto {
  @IsString()
  @IsNotEmpty()
  name!: string;

  @IsString()
  @IsOptional()
  nameEn?: string;

  @IsString()
  @IsOptional()
  description?: string;

  @IsInt()
  @Min(0)
  @IsOptional()
  sortOrder?: number;

  @IsBoolean()
  @IsOptional()
  isActive?: boolean;

  /// The accounting-behavior side — never inferred from name/nameEn.
  @IsEnum(CostAccountingClass)
  @IsOptional()
  accountingClass?: CostAccountingClass;

  @IsBoolean()
  @IsOptional()
  capitalizable?: boolean;

  @IsUUID()
  @IsOptional()
  defaultAccountId?: string;
}
