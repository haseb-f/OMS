import {
  IsBoolean,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Min,
} from 'class-validator';

export const CLASSIFICATION_COLOR_TOKENS = [
  'neutral',
  'info',
  'warning',
  'success',
  'destructive',
] as const;

export class CreateCustomerClassificationDto {
  @IsString()
  @IsNotEmpty()
  name!: string;

  @IsString()
  @IsOptional()
  nameEn?: string;

  @IsString()
  @IsOptional()
  description?: string;

  @IsIn(CLASSIFICATION_COLOR_TOKENS)
  @IsOptional()
  color?: (typeof CLASSIFICATION_COLOR_TOKENS)[number];

  @IsInt()
  @Min(0)
  @IsOptional()
  sortOrder?: number;

  @IsBoolean()
  @IsOptional()
  isActive?: boolean;
}
