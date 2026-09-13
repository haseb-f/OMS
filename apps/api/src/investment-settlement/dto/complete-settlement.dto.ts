import { IsBoolean, IsOptional, IsString } from 'class-validator';

/**
 * Phase 45 — completing with Remaining Units > 0 requires an explicit,
 * reasoned acceptance. Never a silent default. Both fields are optional at
 * the DTO level (a completion with zero Remaining Units needs neither) —
 * `InvestmentSettlementService.complete` is the one place that knows the
 * actual Remaining Units count, so it enforces the non-empty reason only
 * when one is genuinely required.
 */
export class CompleteSettlementDto {
  @IsBoolean()
  @IsOptional()
  acceptUnresolved?: boolean;

  @IsString()
  @IsOptional()
  unresolvedReason?: string;
}
