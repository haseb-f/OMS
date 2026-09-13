import { IsInt, IsString, IsUUID, Min, MinLength } from 'class-validator';

/** Investor Engine Milestone 2, Phase 48 — controlled manual allocation; still enforces every AUTO rule (same Product, eligible sale, capacity caps, no double counting). */
export class ManualAllocateDto {
  @IsUUID()
  opportunityProductId!: string;

  @IsUUID()
  storeOrderItemId!: string;

  @IsInt()
  @Min(1)
  quantity!: number;

  @IsString()
  @MinLength(3)
  reason!: string;
}
