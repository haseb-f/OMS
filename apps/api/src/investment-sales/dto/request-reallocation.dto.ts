import { IsInt, IsString, IsUUID, Min, MinLength } from 'class-validator';

/**
 * Investor Engine Milestone 2, Phase 40 — a cross-Opportunity unit transfer
 * request; execution only happens on the separate, explicit `/approve`
 * action (Phase 65). `sourceAllocationId` names the specific ACTIVE
 * allocation to pull from — unambiguous, and `fromOpportunityId`/
 * `productId`/`storeOrderItemId` are all read directly off that row rather
 * than re-supplied (and possibly mismatched) by the caller.
 */
export class RequestReallocationDto {
  @IsUUID()
  sourceAllocationId!: string;

  @IsUUID()
  toOpportunityId!: string;

  @IsInt()
  @Min(1)
  quantity!: number;

  @IsString()
  @MinLength(3)
  reason!: string;
}
