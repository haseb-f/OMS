import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsNotEmpty,
  IsOptional,
  IsString,
  ValidateNested,
} from 'class-validator';
import { KpiTemplateItemInputDto } from './kpi-template-item-input.dto';

/** Part J/K — a KPI Template with its weighted items. Item weights must sum to 100% across active items (validated in the service, not the DTO — depends on which existing items stay active on update). */
export class CreateKpiTemplateDto {
  @IsString()
  @IsNotEmpty()
  name!: string;

  @IsString()
  @IsOptional()
  nameEn?: string;

  @IsString()
  @IsOptional()
  description?: string;

  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => KpiTemplateItemInputDto)
  items!: KpiTemplateItemInputDto[];
}
