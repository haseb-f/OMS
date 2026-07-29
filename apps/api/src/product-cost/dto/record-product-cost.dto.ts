import { IsNumber, IsOptional, IsString, IsUUID, Min } from 'class-validator';

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

  @IsUUID()
  @IsOptional()
  referenceId?: string;
}
