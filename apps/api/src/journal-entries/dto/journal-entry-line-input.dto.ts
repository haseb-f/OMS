import { IsNumber, IsOptional, IsString, IsUUID, Min } from 'class-validator';
import { IsOptionalUuid } from '../../common/decorators/is-optional-uuid.decorator';

/** One debit/credit line — balance (sum debit === sum credit) is checked in the service, not here. */
export class JournalEntryLineInputDto {
  @IsUUID()
  accountId!: string;

  @IsString()
  @IsOptional()
  description?: string;

  /** TASK-053 — per-line cost attribution (Journal Lines Grid's Cost Center / Project columns). */
  @IsOptionalUuid()
  costCenterId?: string;

  @IsOptionalUuid()
  projectId?: string;

  @IsNumber()
  @Min(0)
  @IsOptional()
  debit?: number;

  @IsNumber()
  @Min(0)
  @IsOptional()
  credit?: number;
}
