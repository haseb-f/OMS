import {
  IsDateString,
  IsInt,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Min,
} from 'class-validator';
import { PartialType } from '@nestjs/mapped-types';
import { IsOptionalUuid } from '../../common/decorators/is-optional-uuid.decorator';

export class CreatePrepaidExpenseDto {
  @IsString()
  @IsNotEmpty()
  name!: string;

  @IsNumber()
  @Min(0.01)
  amount!: number;

  @IsDateString()
  startDate!: string;

  @IsDateString()
  endDate!: string;

  @IsInt()
  @Min(1)
  totalPeriods!: number;

  @IsUUID()
  expenseAccountId!: string;

  @IsUUID()
  receivingAccountId!: string;

  @IsOptionalUuid()
  partnerId?: string;

  @IsOptionalUuid()
  currencyId?: string;

  @IsString()
  @IsOptional()
  notes?: string;
}

export class UpdatePrepaidExpenseDto extends PartialType(
  CreatePrepaidExpenseDto,
) {}

export class RecognizePrepaidDto {
  @IsDateString()
  @IsOptional()
  asOf?: string;
}
