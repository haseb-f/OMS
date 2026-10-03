import {
  IsDateString,
  IsIn,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
} from 'class-validator';
import {
  LEAD_FOLLOW_UP_OUTCOMES,
  type LeadFollowUpOutcome,
} from '../follow-up-outcomes';

export class CreateLeadFollowUpDto {
  /** Master Data channel/method (call, WhatsApp, email, ...) — always optional, same as every other follow-up field. */
  @IsUUID()
  @IsOptional()
  followUpTypeId?: string;

  /** R6 — one of the closed outcome codes; it becomes the lead's follow-up classification. */
  @IsIn(LEAD_FOLLOW_UP_OUTCOMES)
  @IsOptional()
  outcome?: LeadFollowUpOutcome;

  @IsString()
  @IsOptional()
  @MaxLength(4000)
  note?: string;

  @IsDateString()
  @IsOptional()
  followUpAt?: string;
}
