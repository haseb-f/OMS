import { PartialType } from '@nestjs/mapped-types';
import { CreateAnalyticPlanDto } from './create-analytic-plan.dto';

export class UpdateAnalyticPlanDto extends PartialType(CreateAnalyticPlanDto) {}
