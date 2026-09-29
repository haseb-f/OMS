import { Transform, Type } from 'class-transformer';
import {
  IsDateString,
  IsIn,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  ValidateIf,
} from 'class-validator';
import { emptyToUndefined } from '../../../common/transforms/empty-to-undefined';

/** Product commission source (commission-policy.md A4). */
export class SetProductCommissionDto {
  @IsIn(['INHERIT', 'OVERRIDE'])
  source!: 'INHERIT' | 'OVERRIDE';

  /** Required for OVERRIDE; 0 is a valid explicit rate. */
  @ValidateIf((dto: SetProductCommissionDto) => dto.source === 'OVERRIDE')
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 4 })
  @Min(0)
  @Max(100)
  ratePercent?: number;

  @IsDateString()
  effectiveFrom!: string;

  @Transform(emptyToUndefined)
  @IsString()
  @IsOptional()
  @MaxLength(500)
  reason?: string;
}
