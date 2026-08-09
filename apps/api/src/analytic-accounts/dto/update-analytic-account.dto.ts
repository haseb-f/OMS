import { PartialType } from '@nestjs/mapped-types';
import { CreateAnalyticAccountDto } from './create-analytic-account.dto';

export class UpdateAnalyticAccountDto extends PartialType(
  CreateAnalyticAccountDto,
) {}
