import {
  IsBoolean,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  Min,
} from 'class-validator';
import { WorkflowType } from '@prisma/client';

export class CreateStatusDefinitionDto {
  @IsEnum(WorkflowType)
  workflowType!: WorkflowType;

  @IsString()
  code!: string;

  @IsString()
  name!: string;

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
