import {
  IsIn,
  IsNumber,
  IsString,
  IsUUID,
  Min,
  MinLength,
} from 'class-validator';
import { IsOptionalUuid } from '../../common/decorators/is-optional-uuid.decorator';

/** Investor Engine Milestone 3, Phase 30 — the one non-canonical, manual write path; always requires a reason. */
export class CreateLedgerAdjustmentDto {
  @IsUUID()
  investorId!: string;

  @IsOptionalUuid()
  opportunityId?: string;

  @IsNumber()
  @Min(0.01)
  amount!: number;

  @IsIn(['DEBIT', 'CREDIT'])
  direction!: 'DEBIT' | 'CREDIT';

  @IsString()
  @MinLength(3)
  reason!: string;
}
