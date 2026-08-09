import { PartialType } from '@nestjs/mapped-types';
import { CreateSalesQuotationDto } from './create-sales-quotation.dto';

/** Draft-only edit (enforced in the service, not here) — when `items` is
 * supplied, it replaces the full line-item set. */
export class UpdateSalesQuotationDto extends PartialType(
  CreateSalesQuotationDto,
) {}
