import { PartialType } from '@nestjs/mapped-types';
import { CreateLeadFollowUpTypeDto } from './create-lead-follow-up-type.dto';

export class UpdateLeadFollowUpTypeDto extends PartialType(
  CreateLeadFollowUpTypeDto,
) {}
