import { IsOptional, IsString, MaxLength } from 'class-validator';

export class UnreconcileCashFlowDto {
  @IsString()
  @IsOptional()
  @MaxLength(500)
  reason?: string;
}
