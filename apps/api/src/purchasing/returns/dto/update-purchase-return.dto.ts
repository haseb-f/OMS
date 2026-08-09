import { PartialType } from '@nestjs/mapped-types';
import { CreatePurchaseReturnDto } from './create-purchase-return.dto';

export class UpdatePurchaseReturnDto extends PartialType(
  CreatePurchaseReturnDto,
) {}
