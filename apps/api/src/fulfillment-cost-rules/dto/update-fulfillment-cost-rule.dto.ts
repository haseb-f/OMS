import { PartialType } from '@nestjs/mapped-types';
import { CreateFulfillmentCostRuleDto } from './create-fulfillment-cost-rule.dto';

export class UpdateFulfillmentCostRuleDto extends PartialType(
  CreateFulfillmentCostRuleDto,
) {}
