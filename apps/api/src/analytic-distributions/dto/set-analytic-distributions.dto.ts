import { Type } from 'class-transformer';
import {
  IsArray,
  IsNotEmpty,
  IsString,
  IsUUID,
  ValidateNested,
} from 'class-validator';

export class AnalyticDistributionLineDto {
  @IsUUID()
  @IsNotEmpty()
  analyticPlanId!: string;

  @IsUUID()
  @IsNotEmpty()
  analyticAccountId!: string;
}

/**
 * Replaces the full distribution set for one document (TASK-025 Part 2) —
 * every transactional document type (Sales/Purchase Invoice, Expense,
 * Payment, PO, ...) posts here with the same shape, so no per-document-type
 * distribution logic is ever duplicated.
 */
export class SetAnalyticDistributionsDto {
  @IsString()
  @IsNotEmpty()
  documentType!: string;

  @IsUUID()
  @IsNotEmpty()
  documentId!: string;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => AnalyticDistributionLineDto)
  lines!: AnalyticDistributionLineDto[];
}
