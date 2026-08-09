import {
  IsBoolean,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
} from 'class-validator';

export class CreateUnitConversionDto {
  @IsUUID()
  @IsNotEmpty()
  fromUnitId!: string;

  @IsUUID()
  @IsNotEmpty()
  toUnitId!: string;

  @IsNumber()
  @IsNotEmpty()
  conversionRatio!: number;

  @IsString()
  @IsOptional()
  description?: string;

  @IsBoolean()
  @IsOptional()
  isActive?: boolean;
}
