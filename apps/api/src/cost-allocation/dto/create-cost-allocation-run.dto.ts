import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsDateString,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  Min,
  ValidateNested,
} from 'class-validator';
import { IsOptionalUuid } from '../../common/decorators/is-optional-uuid.decorator';

/** Only used when the Rule's method is `MANUAL` — the caller supplies the weight per dimension value directly, never auto-computed. */
export class ManualAllocationBasisDto {
  @IsString()
  @IsNotEmpty()
  dimensionValue!: string;

  @IsString()
  @IsNotEmpty()
  dimensionLabel!: string;

  @IsNumber()
  @Min(0)
  weight!: number;
}

/** M4 — creates a DRAFT `CostAllocationRun`. Exactly one of `sourceAccountId` / `manualPoolAmount` must be given (validated in the service, not here, since it's a cross-field rule). */
export class CreateCostAllocationRunDto {
  @IsDateString()
  periodStart!: string;

  @IsDateString()
  periodEnd!: string;

  @IsOptionalUuid()
  sourceAccountId?: string;

  @IsNumber()
  @Min(0)
  @IsOptional()
  manualPoolAmount?: number;

  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => ManualAllocationBasisDto)
  @IsOptional()
  manualBases?: ManualAllocationBasisDto[];

  @IsString()
  @IsOptional()
  notes?: string;
}
