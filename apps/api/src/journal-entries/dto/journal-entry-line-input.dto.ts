import { IsNumber, IsOptional, IsString, IsUUID, Min } from 'class-validator';

/** One debit/credit line — balance (sum debit === sum credit) is checked in the service, not here. */
export class JournalEntryLineInputDto {
  @IsUUID()
  accountId!: string;

  @IsString()
  @IsOptional()
  description?: string;

  /** TASK-053 — per-line cost attribution (Journal Lines Grid's Cost Center / Project columns). */
  @IsUUID()
  @IsOptional()
  costCenterId?: string;

  @IsUUID()
  @IsOptional()
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
