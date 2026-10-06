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

  /**
   * Optional — always derived as the last day of the final monthly period
   * (start + totalPeriods months − 1 day). When sent it must equal that date.
   */
  @IsDateString()
  @IsOptional()
  endDate?: string;

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

/** Recognition schedule an unsaved prepaid form would get. */
export class PrepaidPreviewDto {
  @IsNumber()
  @Min(0.01)
  amount!: number;

  @IsInt()
  @Min(1)
  totalPeriods!: number;

  @IsDateString()
  startDate!: string;
}
