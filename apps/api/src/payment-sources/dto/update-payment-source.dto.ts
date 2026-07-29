import { PartialType } from '@nestjs/mapped-types';
import { CreatePaymentSourceDto } from './create-payment-source.dto';

export class UpdatePaymentSourceDto extends PartialType(
  CreatePaymentSourceDto,
) {}
