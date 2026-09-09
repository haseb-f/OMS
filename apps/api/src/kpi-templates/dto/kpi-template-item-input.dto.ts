import { Type } from 'class-transformer';
import {
  IsArray,
  IsBoolean,
  IsEnum,
  IsInt,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Min,
  ValidateNested,
} from 'class-validator';
import {
  KpiAutoMetricSource,
  KpiEvaluatorSource,
  KpiItemType,
} from '@prisma/client';

export class KpiDropdownOptionDto {
  @IsString()
  @IsNotEmpty()
  label!: string;

  @IsNumber()
  @Min(0)
  score!: number;
}

/** Part K — one weighted KPI criterion. `id` present = update this existing item in place; absent = create a new one (Part J's "never delete, soft-remove" — see KpiTemplatesService.update). */
export class KpiTemplateItemInputDto {
  @IsUUID()
  @IsOptional()
  id?: string;

  @IsString()
  @IsNotEmpty()
  criterionAr!: string;

  @IsString()
  @IsOptional()
  criterionEn?: string;

  @IsNumber()
  @Min(0)
  weight!: number;

  @IsEnum(KpiItemType)
  itemType!: KpiItemType;

  @IsEnum(KpiEvaluatorSource)
  evaluatorSource!: KpiEvaluatorSource;

  @IsEnum(KpiAutoMetricSource)
  @IsOptional()
  autoMetricSource?: KpiAutoMetricSource;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => KpiDropdownOptionDto)
  @IsOptional()
  dropdownOptions?: KpiDropdownOptionDto[];

  @IsInt()
  @Min(0)
  @IsOptional()
  sortOrder?: number;

  @IsBoolean()
  @IsOptional()
  isActive?: boolean;
}
