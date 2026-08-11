import { IsInt, IsNumber, IsOptional, IsString, Min } from 'class-validator';
import { IsOptionalUuid } from '../../common/decorators/is-optional-uuid.decorator';

/**
 * Pricing snapshot per line item — decision #5. No computed totals; raw
 * values only. SalesOrder -> OrderItem -> Product (placeholder) — Product is
 * never linked directly to SalesOrder (TASK-012 decision #1).
 */
export class OrderItemInputDto {
  /** No Product entity/module exists yet — reserved for future integration, not a foreign key. */
  @IsOptionalUuid()
  productId?: string;

  @IsInt()
  @Min(1)
  quantity!: number;

  @IsNumber()
  @Min(0)
  unitPrice!: number;

  @IsNumber()
  @Min(0)
  @IsOptional()
  discount?: number;

  @IsString()
  @IsOptional()
  offer?: string;
}
