import {
  IsBoolean,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';

export class CapitalReturnCorrectionDto {
  @IsString()
  @MinLength(5)
  @MaxLength(500)
  reason!: string;

  @IsBoolean()
  @IsOptional()
  dryRun?: boolean;
}
