import {
  IsDateString,
  IsInt,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  Min,
} from 'class-validator';
import { IsOptionalUuid } from '../../common/decorators/is-optional-uuid.decorator';

export class CreateFixedAssetDto {
  @IsString()
  @IsNotEmpty()
  name!: string;

  @IsString()
  @IsOptional()
  code?: string;

  @IsDateString()
  acquisitionDate!: string;

  @IsNumber()
  @Min(0)
  cost!: number;

  @IsOptionalUuid()
  costCenterId?: string;

  @IsInt()
  @Min(1)
  @IsOptional()
  usefulLifeMonths?: number;

  @IsNumber()
  @Min(0)
  @IsOptional()
  salvageValue?: number;

  @IsDateString()
  @IsOptional()
  depreciationStartDate?: string;

  @IsOptionalUuid()
  receivingAccountId?: string;

  @IsOptionalUuid()
  partnerId?: string;

  @IsString()
  @IsOptional()
  notes?: string;
}
