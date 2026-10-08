import { Transform, Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsEnum,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsPositive,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
  ValidateNested,
} from 'class-validator';
import { ReturnItemCondition } from '@prisma/client';
import { IsOptionalUuid } from '../../../common/decorators/is-optional-uuid.decorator';

const trim = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;

export class StoreOrderReturnLineDto {
  /** A line of one of the order's posted (delivered) invoices. */
  @IsUUID()
  salesInvoiceItemId!: string;

  @IsInt()
  @IsPositive()
  quantity!: number;
}

/** R15 (D15-10) — "Return": request a return of delivered goods (no stock effect yet). */
export class RequestStoreOrderReturnDto {
  @Transform(trim)
  @IsString()
  @IsNotEmpty({ message: 'A return reason is required.' })
  @MaxLength(500)
  reason!: string;

  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => StoreOrderReturnLineDto)
  lines!: StoreOrderReturnLineDto[];

  /** One key per opened dialog — a retried submit returns the first request. */
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  @Matches(/^[A-Za-z0-9_-]+$/, {
    message: 'idempotencyKey may contain only letters, digits, "-" and "_".',
  })
  idempotencyKey!: string;
}

export class ReceiveReturnLineDto {
  @IsUUID()
  salesReturnItemId!: string;

  @IsEnum(ReturnItemCondition)
  condition!: ReturnItemCondition;

  /** SALEABLE → a stock warehouse, DAMAGED → a damaged-goods warehouse; defaulted when omitted. */
  @IsOptionalUuid()
  warehouseId?: string;
}

/** R15 (D15-10) — "Receive & inspect": physical receipt with the condition per line (default SALEABLE). */
export class ReceiveStoreOrderReturnDto {
  @IsArray()
  @IsOptional()
  @ValidateNested({ each: true })
  @Type(() => ReceiveReturnLineDto)
  lines?: ReceiveReturnLineDto[];
}
