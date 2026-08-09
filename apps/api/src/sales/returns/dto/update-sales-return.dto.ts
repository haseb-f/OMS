import { PartialType } from '@nestjs/mapped-types';
import { CreateSalesReturnDto } from './create-sales-return.dto';

/** Draft-only edit (enforced in the service) — when `items` is supplied, it replaces the full line-item set. */
export class UpdateSalesReturnDto extends PartialType(CreateSalesReturnDto) {}
