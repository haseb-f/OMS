import { PartialType } from '@nestjs/mapped-types';
import { CreateSalesOrderDto } from './create-sales-order.dto';

/** Draft-only edit (enforced in the service) — when `items` is supplied, it replaces the full line-item set. */
export class UpdateSalesOrderDto extends PartialType(CreateSalesOrderDto) {}
