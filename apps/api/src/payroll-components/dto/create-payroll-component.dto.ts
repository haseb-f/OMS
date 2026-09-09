import {
  IsBoolean,
  IsEnum,
  IsInt,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  Min,
} from 'class-validator';
import {
  PayrollComponentCalculationType,
  PayrollComponentType,
} from '@prisma/client';
import { IsOptionalUuid } from '../../common/decorators/is-optional-uuid.decorator';

/** Part H — dynamic Payroll Component catalog (بدل سكن / بدل نقل / خصم غياب / ...). Never hardcoded in payroll logic, only referenced by id. */
export class CreatePayrollComponentDto {
  @IsString()
  @IsNotEmpty()
  nameAr!: string;

  @IsString()
  @IsOptional()
  nameEn?: string;

  @IsEnum(PayrollComponentType)
  type!: PayrollComponentType;

  @IsEnum(PayrollComponentCalculationType)
  @IsOptional()
  calculationType?: PayrollComponentCalculationType;

  @IsNumber()
  @Min(0)
  @IsOptional()
  defaultValue?: number;

  @IsOptionalUuid()
  accountingMappingAccountId?: string;

  @IsInt()
  @Min(0)
  @IsOptional()
  sortOrder?: number;

  @IsBoolean()
  @IsOptional()
  isActive?: boolean;
}
