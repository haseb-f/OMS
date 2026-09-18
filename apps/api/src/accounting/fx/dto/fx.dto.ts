import {
  IsDateString,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Min,
} from 'class-validator';
import { IsOptionalUuid } from '../../../common/decorators/is-optional-uuid.decorator';

export class CreateExchangeRateDto {
  @IsUUID()
  fromCurrencyId!: string;

  @IsUUID()
  toCurrencyId!: string;

  @IsNumber()
  @Min(0.00000001)
  rate!: number;

  @IsDateString()
  effectiveDate!: string;

  @IsString()
  @IsOptional()
  notes?: string;
}

export class ExchangeRateQueryDto {
  @IsOptionalUuid()
  fromCurrencyId?: string;

  @IsOptionalUuid()
  toCurrencyId?: string;

  @IsDateString()
  @IsOptional()
  asOf?: string;
}

export class RunFxRevaluationDto {
  @IsDateString()
  rateDate!: string;

  @IsString()
  @IsOptional()
  notes?: string;
}
