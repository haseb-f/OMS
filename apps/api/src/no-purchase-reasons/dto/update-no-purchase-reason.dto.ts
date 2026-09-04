import { PartialType } from '@nestjs/mapped-types';
import { CreateNoPurchaseReasonDto } from './create-no-purchase-reason.dto';

export class UpdateNoPurchaseReasonDto extends PartialType(
  CreateNoPurchaseReasonDto,
) {}
