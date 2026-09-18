import {
  IsDateString,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Min,
} from 'class-validator';
import { PartialType } from '@nestjs/mapped-types';
import { IsOptionalUuid } from '../../common/decorators/is-optional-uuid.decorator';

export class CreateAccruedExpenseDto {
  @IsString()
  @IsNotEmpty()
  name!: string;

  @IsNumber()
  @Min(0.01)
  amount!: number;

  @IsDateString()
  recognitionDate!: string;

  @IsUUID()
  expenseAccountId!: string;

  @IsOptionalUuid()
  receivingAccountId?: string;

  @IsOptionalUuid()
  partnerId?: string;

  @IsOptionalUuid()
  currencyId?: string;

  @IsString()
  @IsOptional()
  notes?: string;
}

export class UpdateAccruedExpenseDto extends PartialType(
  CreateAccruedExpenseDto,
) {}

export class SettleAccruedExpenseDto {
  @IsUUID()
  receivingAccountId!: string;
}
