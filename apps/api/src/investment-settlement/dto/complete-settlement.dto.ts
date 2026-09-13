import { IsBoolean, IsOptional, IsString, ValidateIf } from 'class-validator';

/** Phase 45 — completing with Remaining Units > 0 requires an explicit, reasoned acceptance. Never a silent default. */
export class CompleteSettlementDto {
  @IsBoolean()
  @IsOptional()
  acceptUnresolved?: boolean;

  @ValidateIf((dto: CompleteSettlementDto) => dto.acceptUnresolved === true)
  @IsString()
  unresolvedReason?: string;
}
