import { Transform, Type } from 'class-transformer';
import { emptyToUndefined } from '../../common/transforms/empty-to-undefined';
import {
  ArrayMinSize,
  IsArray,
  IsDateString,
  IsEnum,
  IsOptional,
  IsString,
  IsUUID,
  ValidateNested,
} from 'class-validator';
import { StoreOrderSource, StoreOrderPaymentType } from '@prisma/client';
import { IsOptionalUuid } from '../../common/decorators/is-optional-uuid.decorator';
import { FindOrCreateCustomerDto } from '../../customers/dto/find-or-create-customer.dto';
import { CreateStoreOrderItemDto } from './create-store-order-item.dto';
import { CreateStoreOrderPaymentDto } from './create-store-order-payment.dto';

/**
 * `internalOrderId` is never accepted here — always minted server-side via
 * the Numbering Engine ("STORE_ORDER" key), same convention as
 * `Customer.customerNumber`. The customer is never a raw `customerId` —
 * `customer` is resolved through `CustomersService.findOrCreate` (phone/
 * email dedup, never a second matching mechanism), exactly like the Manual
 * Create path and the Import handler both must.
 */
export class CreateStoreOrderDto {
  /** The source system's own order id — the unique import identity. Omitted for a Manual order. */
  @IsString()
  @IsOptional()
  externalOrderId?: string;

  @ValidateNested()
  @Type(() => FindOrCreateCustomerDto)
  customer!: FindOrCreateCustomerDto;

  @IsDateString()
  @IsOptional()
  orderDate?: string;

  @IsEnum(StoreOrderSource)
  @IsOptional()
  source?: StoreOrderSource;

  @IsString()
  @IsOptional()
  sourceChannel?: string;

  @IsOptionalUuid()
  employeeId?: string;

  @IsUUID()
  currencyId!: string;

  @IsEnum(StoreOrderPaymentType)
  @IsOptional()
  paymentType?: StoreOrderPaymentType;

  @Transform(emptyToUndefined)
  @IsString()
  @IsOptional()
  notes?: string;

  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => CreateStoreOrderItemDto)
  items!: CreateStoreOrderItemDto[];

  /** Optional first payment, created atomically with the order (e.g. a marketplace order that arrives already partially paid). */
  @ValidateNested()
  @Type(() => CreateStoreOrderPaymentDto)
  @IsOptional()
  payment?: CreateStoreOrderPaymentDto;
}
