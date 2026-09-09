import { Type } from 'class-transformer';
import {
  ArrayUnique,
  IsArray,
  IsDateString,
  IsNumber,
  IsOptional,
  IsString,
  Min,
  ValidateNested,
} from 'class-validator';
import { CompensationLineInputDto } from './compensation-line-input.dto';

/** Part G/Salary History — one new effective-dated Compensation Revision. Never edits a past revision; the service enforces "future-dated only" for in-place correction. */
export class RecordCompensationDto {
  @IsDateString()
  effectiveFrom!: string;

  @IsNumber()
  @Min(0)
  basicSalary!: number;

  @IsNumber()
  @Min(0)
  @IsOptional()
  kpiMaxPay?: number;

  @IsString()
  @IsOptional()
  notes?: string;

  @IsArray()
  @ArrayUnique((line: CompensationLineInputDto) => line.payrollComponentId)
  @ValidateNested({ each: true })
  @Type(() => CompensationLineInputDto)
  @IsOptional()
  lines?: CompensationLineInputDto[];
}
