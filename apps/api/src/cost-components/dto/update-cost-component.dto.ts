import { PartialType } from '@nestjs/mapped-types';
import { CreateCostComponentDto } from './create-cost-component.dto';

export class UpdateCostComponentDto extends PartialType(
  CreateCostComponentDto,
) {}
