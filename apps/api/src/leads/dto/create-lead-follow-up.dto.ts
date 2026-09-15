import {
  IsDateString,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
} from 'class-validator';

export class CreateLeadFollowUpDto {
  /** Master Data channel/method (call, WhatsApp, email, ...) — always optional, same as every other follow-up field. */
  @IsUUID()
  @IsOptional()
  followUpTypeId?: string;

  @IsString()
  @IsOptional()
  @MaxLength(80)
  outcome?: string;

  @IsString()
  @IsOptional()
  @MaxLength(4000)
  note?: string;

  @IsDateString()
  @IsOptional()
  followUpAt?: string;
}
