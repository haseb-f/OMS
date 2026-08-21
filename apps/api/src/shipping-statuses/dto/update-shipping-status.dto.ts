import { PartialType } from '@nestjs/mapped-types';
import { CreateShippingStatusDto } from './create-shipping-status.dto';

export class UpdateShippingStatusDto extends PartialType(
  CreateShippingStatusDto,
) {}
