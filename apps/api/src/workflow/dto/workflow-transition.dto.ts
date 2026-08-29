import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  Min,
} from 'class-validator';
import { WorkflowBusinessAction, WorkflowType } from '@prisma/client';

export class CreateWorkflowTransitionDto {
  @IsEnum(WorkflowType)
  workflowType!: WorkflowType;

  @IsUUID()
  fromStatusId!: string;

  @IsUUID()
  toStatusId!: string;

  @IsString()
  @MaxLength(120)
  labelAr!: string;

  @IsString()
  @IsOptional()
  @MaxLength(120)
  labelEn?: string;

  @IsBoolean()
  @IsOptional()
  requiresApproval?: boolean;

  @IsBoolean()
  @IsOptional()
  requiresReason?: boolean;

  @IsString()
  @IsOptional()
  requiredPermission?: string;

  @IsEnum(WorkflowBusinessAction)
  @IsOptional()
  businessAction?: WorkflowBusinessAction;

  @Type(() => Number)
  @IsInt()
  @Min(0)
  @IsOptional()
  sortOrder?: number;
}

export class UpdateWorkflowTransitionDto {
  @IsString()
  @IsOptional()
  @MaxLength(120)
  labelAr?: string;

  @IsString()
  @IsOptional()
  @MaxLength(120)
  labelEn?: string;

  @IsBoolean()
  @IsOptional()
  requiresApproval?: boolean;

  @IsBoolean()
  @IsOptional()
  requiresReason?: boolean;

  @IsString()
  @IsOptional()
  requiredPermission?: string;

  @IsBoolean()
  @IsOptional()
  isActive?: boolean;

  @Type(() => Number)
  @IsInt()
  @Min(0)
  @IsOptional()
  sortOrder?: number;
}
