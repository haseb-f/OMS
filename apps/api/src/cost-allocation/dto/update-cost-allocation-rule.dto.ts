import { PartialType } from '@nestjs/mapped-types';
import { CreateCostAllocationRuleDto } from './create-cost-allocation-rule.dto';

export class UpdateCostAllocationRuleDto extends PartialType(
  CreateCostAllocationRuleDto,
) {}
