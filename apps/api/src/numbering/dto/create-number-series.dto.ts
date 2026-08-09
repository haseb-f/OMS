import {
  IsBoolean,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Max,
  Min,
} from 'class-validator';

export class CreateNumberSeriesDto {
  @IsString()
  @IsNotEmpty()
  documentType!: string;

  @IsString()
  @IsNotEmpty()
  label!: string;

  @IsString()
  @IsNotEmpty()
  docCode!: string;

  @IsString()
  @IsNotEmpty()
  template!: string;

  @IsInt()
  @Min(1)
  @IsOptional()
  nextNumber?: number;

  @IsInt()
  @Min(1)
  @Max(12)
  @IsOptional()
  padding?: number;

  @IsString()
  @IsOptional()
  separator?: string;

  @IsBoolean()
  @IsOptional()
  yearReset?: boolean;

  @IsBoolean()
  @IsOptional()
  monthReset?: boolean;

  @IsBoolean()
  @IsOptional()
  dayReset?: boolean;

  @IsBoolean()
  @IsOptional()
  active?: boolean;
}
