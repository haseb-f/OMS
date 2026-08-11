import { IsNumber, IsOptional, IsString, Min } from 'class-validator';
import { IsOptionalUuid } from '../../common/decorators/is-optional-uuid.decorator';

/** Records a caller-supplied cost value — no calculation happens here. */
export class RecordProductCostDto {
  @IsNumber()
  @Min(0)
  cost!: number;

  @IsString()
  @IsOptional()
  reason?: string;

  @IsString()
  @IsOptional()
  referenceType?: string;

  @IsOptionalUuid()
  referenceId?: string;
}
