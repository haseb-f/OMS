import { PartialType } from '@nestjs/mapped-types';
import { CreatePurchaseInvoiceDto } from './create-purchase-invoice.dto';

export class UpdatePurchaseInvoiceDto extends PartialType(
  CreatePurchaseInvoiceDto,
) {}
