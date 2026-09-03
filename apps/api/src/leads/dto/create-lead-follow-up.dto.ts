import { IsDateString, IsOptional, IsString, MaxLength } from 'class-validator';

export class CreateLeadFollowUpDto {
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

  @IsString()
  @IsOptional()
  @MaxLength(40)
  channel?: string;
}
