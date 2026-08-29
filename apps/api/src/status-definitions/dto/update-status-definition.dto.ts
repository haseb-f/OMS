import { IsBoolean, IsInt, IsOptional, IsString, Min } from 'class-validator';

export class UpdateStatusDefinitionDto {
  @IsString()
  @IsOptional()
  name?: string;

  @IsString()
  @IsOptional()
  nameEn?: string;

  @IsString()
  @IsOptional()
  color?: string;

  @IsInt()
  @Min(0)
  @IsOptional()
  sortOrder?: number;

  @IsBoolean()
  @IsOptional()
  isFinal?: boolean;

  @IsBoolean()
  @IsOptional()
  isDefault?: boolean;
}
