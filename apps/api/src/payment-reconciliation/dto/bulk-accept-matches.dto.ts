import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  ValidateIf,
  ValidateNested,
} from 'class-validator';
import { BULK_LIMITS } from '../../common/bulk/bulk-limits';

export class BulkAcceptItemDto {
  @IsUUID()
  statementLineId!: string;

  /**
   * The claim the user saw suggested (from the dry run). When given, the
   * server accepts only if it is STILL the line's strong, unambiguous top
   * suggestion — otherwise the item fails with SUGGESTION_CHANGED.
   */
  @IsOptional()
  @IsUUID()
  paymentId?: string;
}

export class BulkAcceptMatchesDto {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(BULK_LIMITS.statementBulkAcceptMax)
  @ValidateNested({ each: true })
  @Type(() => BulkAcceptItemDto)
  items!: BulkAcceptItemDto[];

  /** Plan only: returns the eligible pairs and the refusals, changes nothing. */
  @IsOptional()
  @IsBoolean()
  dryRun?: boolean;

  /** Client key per user action; each line confirms under `<key>:<lineId>` (a retry never allocates twice). */
  @ValidateIf((dto: BulkAcceptMatchesDto) => !dto.dryRun)
  @IsString()
  @IsNotEmpty()
  @MaxLength(80)
  idempotencyKey?: string;
}
