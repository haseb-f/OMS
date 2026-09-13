import { PartialType } from '@nestjs/mapped-types';
import { CreateInvestmentOpportunityDto } from './create-investment-opportunity.dto';

/** Draft-only (or Open-with-no-confirmed-funding) edit — see InvestmentOpportunitiesService.update's lock rule (Phase 27/32). */
export class UpdateInvestmentOpportunityDto extends PartialType(
  CreateInvestmentOpportunityDto,
) {}
