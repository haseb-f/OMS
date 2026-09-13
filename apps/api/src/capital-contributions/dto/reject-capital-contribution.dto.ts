import { IsOptional, IsString } from 'class-validator';

export class RejectCapitalContributionDto {
  @IsString()
  @IsOptional()
  reason?: string;
}
