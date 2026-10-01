import { Transform } from 'class-transformer';
import { OmitType } from '@nestjs/mapped-types';
import { IsIn, IsOptional, IsString, MaxLength } from 'class-validator';
import { IsOptionalUuid } from '../../../common/decorators/is-optional-uuid.decorator';
import { emptyToUndefined } from '../../../common/transforms/empty-to-undefined';
import {
  DUPLICATE_DECISIONS,
  type DuplicateDecision,
} from '../duplicate-outcome';

/**
 * The creator's answer to the duplicate warning (Spec 1B). The server re-runs
 * the check; this never names a customer the caller could not see.
 */
export class DuplicateResolutionDto {
  @IsIn(DUPLICATE_DECISIONS)
  decision!: DuplicateDecision;

  /** The matched / chosen existing customer (from the check result). */
  @IsOptionalUuid()
  customerId?: string;
}

export class DuplicateCheckDto {
  @Transform(emptyToUndefined)
  @IsString()
  @IsOptional()
  @MaxLength(40)
  phone?: string;

  @Transform(emptyToUndefined)
  @IsString()
  @IsOptional()
  @MaxLength(200)
  name?: string;

  /** Phone country (resolves a local number). */
  @IsOptionalUuid()
  countryId?: string;

  /** Internal staff entering an agent order: check within that agent's customers. */
  @IsOptionalUuid()
  agentId?: string;
}

/** Agent portal: the agent always comes from the verified context. */
export class AgentDuplicateCheckDto extends OmitType(DuplicateCheckDto, [
  'agentId',
] as const) {}

export class ResolveDuplicateReviewDto {
  @IsIn(['CONFIRMED_DISTINCT', 'CONFIRMED_DUPLICATE'])
  decision!: 'CONFIRMED_DISTINCT' | 'CONFIRMED_DUPLICATE';

  @Transform(emptyToUndefined)
  @IsString()
  @IsOptional()
  @MaxLength(1000)
  note?: string;
}
