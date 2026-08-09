import {
  ArrayMinSize,
  IsArray,
  IsDateString,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Min,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';

/** One account's opening balance — a debit OR a credit, same shape as a manual Journal Entry line. */
export class OpeningBalanceLineInputDto {
  @IsUUID()
  accountId!: string;

  @IsString()
  @IsOptional()
  description?: string;

  @IsNumber()
  @Min(0)
  @IsOptional()
  debit?: number;

  @IsNumber()
  @Min(0)
  @IsOptional()
  credit?: number;
}

export class CreateOpeningBalanceDto {
  @IsUUID()
  fiscalYearId!: string;

  @IsDateString()
  openingDate!: string;

  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => OpeningBalanceLineInputDto)
  lines!: OpeningBalanceLineInputDto[];
}
