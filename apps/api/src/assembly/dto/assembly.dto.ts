import { Transform, Type } from 'class-transformer';
import {
  IsDateString,
  IsEnum,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  Matches,
  MaxLength,
  Min,
} from 'class-validator';
import { AssemblyStatus } from '@prisma/client';
import { IsDecimalString } from '../../common/decorators/decimal-string.decorator';

/** Order quantities are `Int` columns. */
const MAX_QUANTITY = 1_000_000_000;

export class CreateAssemblyDto {
  /** The finished product — must be ASSEMBLED with an active recipe. */
  @IsUUID()
  productId!: string;

  @IsUUID()
  warehouseId!: string;

  /** Finished units to produce. */
  @IsInt()
  @Min(1)
  @Max(MAX_QUANTITY)
  quantity!: number;

  /** Approved labour / overhead for this order (2 dp). Needs `inventory.assembly.direct_cost`. */
  @IsOptional()
  @IsDecimalString({ maxDecimals: 2, maxIntegerDigits: 12 })
  directCost?: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  notes?: string;

  /** A retried request with the same key returns the original order instead of assembling twice (also accepted as the `Idempotency-Key` header). */
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  @Matches(/^[A-Za-z0-9._:-]+$/, {
    message:
      'idempotencyKey may only contain letters, digits, ".", "_", ":" and "-".',
  })
  idempotencyKey?: string;
}

export class ReverseAssemblyDto {
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  @IsString()
  @IsNotEmpty()
  @MaxLength(500)
  reason!: string;
}

export class AssemblyPreviewQueryDto {
  @IsUUID()
  productId!: string;

  @IsUUID()
  warehouseId!: string;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(MAX_QUANTITY)
  quantity!: number;
}

export class ListAssemblyQueryDto {
  @IsOptional()
  @IsUUID()
  productId?: string;

  @IsOptional()
  @IsUUID()
  warehouseId?: string;

  @IsOptional()
  @IsEnum(AssemblyStatus)
  status?: AssemblyStatus;

  /** Inclusive; a plain date covers the whole day. */
  @IsOptional()
  @IsDateString()
  from?: string;

  @IsOptional()
  @IsDateString()
  to?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number = 1;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(200)
  pageSize?: number = 20;
}
