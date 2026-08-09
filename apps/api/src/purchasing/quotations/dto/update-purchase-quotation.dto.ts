import { PartialType } from '@nestjs/mapped-types';
import { CreatePurchaseQuotationDto } from './create-purchase-quotation.dto';

export class UpdatePurchaseQuotationDto extends PartialType(
  CreatePurchaseQuotationDto,
) {}
