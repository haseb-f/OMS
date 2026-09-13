import { PartialType, OmitType } from '@nestjs/mapped-types';
import { CreateOpportunityExpenseDto } from './create-opportunity-expense.dto';

/** DRAFT-only edit — see InvestmentExpensesService.update's status guard. */
export class UpdateOpportunityExpenseDto extends PartialType(
  OmitType(CreateOpportunityExpenseDto, ['opportunityId'] as const),
) {}
