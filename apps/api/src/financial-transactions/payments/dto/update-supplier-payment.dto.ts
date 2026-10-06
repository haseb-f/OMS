import { OmitType, PartialType } from '@nestjs/mapped-types';
import { CreateSupplierPaymentDto } from './create-supplier-payment.dto';

export class UpdateSupplierPaymentDto extends PartialType(
  OmitType(CreateSupplierPaymentDto, ['idempotencyKey'] as const),
) {}
