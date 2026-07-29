import { PartialType } from '@nestjs/mapped-types';
import { CreateReceivingAccountDto } from './create-receiving-account.dto';

export class UpdateReceivingAccountDto extends PartialType(
  CreateReceivingAccountDto,
) {}
