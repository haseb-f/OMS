import { IsOptional, IsString } from 'class-validator';

export class RejectDistributionPaymentDto {
  @IsString()
  @IsOptional()
  reason?: string;
}
