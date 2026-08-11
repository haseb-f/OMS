import {
  IsBoolean,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
} from 'class-validator';
import { IsOptionalUuid } from '../../common/decorators/is-optional-uuid.decorator';

export class CreateAnalyticAccountDto {
  @IsString()
  @IsNotEmpty()
  code!: string;

  @IsString()
  @IsNotEmpty()
  name!: string;

  @IsUUID()
  @IsNotEmpty()
  analyticPlanId!: string;

  /// Unlimited hierarchy (TASK-025 Part 1) — a real self-relation FK, no
  /// depth limit or cycle check (same prepared-only pattern as
  /// Warehouse.parentWarehouseId).
  @IsOptionalUuid()
  parentAccountId?: string;

  @IsBoolean()
  @IsOptional()
  active?: boolean;

  @IsString()
  @IsOptional()
  notes?: string;
}
