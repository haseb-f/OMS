import {
  IsDateString,
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

  @IsString()
  @IsOptional()
  notes?: string;
}
