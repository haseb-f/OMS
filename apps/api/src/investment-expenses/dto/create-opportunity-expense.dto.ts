import {
  IsDateString,
  IsEnum,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Min,
  MinLength,
} from 'class-validator';
import { OpportunityExpenseCategory } from '@prisma/client';
import { IsOptionalUuid } from '../../common/decorators/is-optional-uuid.decorator';

/** Investor Engine Milestone 2, Phase 15/16 — an Opportunity-level expense only; created DRAFT, never affects Approved Profit until approved. */
export class CreateOpportunityExpenseDto {
  @IsUUID()
  opportunityId!: string;

  @IsDateString()
  expenseDate!: string;

  @IsEnum(OpportunityExpenseCategory)
  category!: OpportunityExpenseCategory;

  @IsString()
  @MinLength(2)
  description!: string;

  @IsNumber()
  @Min(0.01)
  amount!: number;

  @IsOptionalUuid()
  sourceExpenseId?: string;

  @IsString()
  @IsOptional()
  notes?: string;
}
