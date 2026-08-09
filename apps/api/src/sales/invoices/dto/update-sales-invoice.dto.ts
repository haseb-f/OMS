import { PartialType } from '@nestjs/mapped-types';
import { CreateSalesInvoiceDto } from './create-sales-invoice.dto';

/** Draft-only edit (enforced in the service) — when `items` is supplied, it replaces the full line-item set. */
export class UpdateSalesInvoiceDto extends PartialType(CreateSalesInvoiceDto) {}
