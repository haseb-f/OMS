import { IsInt, IsString, Min, MinLength } from 'class-validator';

/** Investor Engine Milestone 2, Phase 11/69 — a partial or full return/refund against one ACTIVE allocation. The still-valid remainder (if any) is re-allocated as a new ACTIVE row so history stays traceable. */
export class RecordReturnDto {
  @IsInt()
  @Min(1)
  quantity!: number;

  @IsString()
  @MinLength(3)
  reason!: string;
}
