import { Transform, Type } from 'class-transformer';
import {
  IsDateString,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { StoreOrderPaymentStatus } from '@prisma/client';
import { IsOptionalUuid } from '../../../common/decorators/is-optional-uuid.decorator';
import { emptyToUndefined } from '../../../common/transforms/empty-to-undefined';

/** 1-based paging; pageSize ≤ 200 (apps/web `fetchAllPages` page size). */
export class AgentPortalPageQueryDto {
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @IsOptional()
  page?: number = 1;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(200)
  @IsOptional()
  pageSize?: number = 20;
}

export const DECLARED_PAYMENT_STATUSES = [
  'UNPAID',
  'PARTIALLY_PAID',
  'PAID',
] as const;

/** GET /agent-portal/orders — every filter is applied inside the caller's visibility. */
export class AgentPortalOrdersQueryDto extends AgentPortalPageQueryDto {
  @Transform(emptyToUndefined)
  @IsString()
  @MaxLength(200)
  @IsOptional()
  search?: string;

  /** What the agent declared (never Finance verification). */
  @Transform(emptyToUndefined)
  @IsIn(DECLARED_PAYMENT_STATUSES)
  @IsOptional()
  declaredPaymentStatus?: (typeof DECLARED_PAYMENT_STATUSES)[number];

  /** Finance payment status of the order. */
  @Transform(emptyToUndefined)
  @IsIn(Object.values(StoreOrderPaymentStatus))
  @IsOptional()
  paymentStatus?: StoreOrderPaymentStatus;

  /** Fulfillment status code (e.g. AWAITING_PREPARATION, SHIPPED, DELIVERED, CANCELLED). */
  @Transform(emptyToUndefined)
  @IsString()
  @MaxLength(60)
  @IsOptional()
  fulfillmentStatusCode?: string;

  @Transform(emptyToUndefined)
  @IsIn(['SHIPPING', 'PICKUP'])
  @IsOptional()
  fulfillmentMethod?: 'SHIPPING' | 'PICKUP';

  /** Order date range, inclusive calendar days (YYYY-MM-DD). */
  @Transform(emptyToUndefined)
  @IsDateString()
  @IsOptional()
  from?: string;

  @Transform(emptyToUndefined)
  @IsDateString()
  @IsOptional()
  to?: string;
}

export class AgentPortalProductsQueryDto extends AgentPortalPageQueryDto {
  @Transform(emptyToUndefined)
  @IsString()
  @MaxLength(200)
  @IsOptional()
  search?: string;
}

export class AgentPortalStockQueryDto {
  @IsOptionalUuid()
  productId?: string;

  @IsOptionalUuid()
  warehouseId?: string;
}

export class AgentPortalStatementQueryDto {
  @Transform(emptyToUndefined)
  @IsDateString()
  @IsOptional()
  from?: string;

  @Transform(emptyToUndefined)
  @IsDateString()
  @IsOptional()
  to?: string;
}

export class AssignAgentLeadDto {
  /** A user of the caller's own agent (checked server-side). */
  @IsUUID()
  salesUserId!: string;
}
