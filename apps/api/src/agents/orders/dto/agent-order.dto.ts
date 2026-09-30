import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsDateString,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsPositive,
  IsString,
  IsUUID,
  MaxLength,
  Min,
  ValidateIf,
  ValidateNested,
} from 'class-validator';
import { IsOptionalUuid } from '../../../common/decorators/is-optional-uuid.decorator';
import { emptyToUndefined } from '../../../common/transforms/empty-to-undefined';
import { DECLARATION_KINDS } from '../../../store-orders/dto/declare-store-order-payment.dto';
import { DuplicateResolutionDto } from '../../../store-orders/duplicates/dto/duplicate.dto';

export class AgentOrderLineDto {
  @IsUUID()
  productId!: string;

  @Type(() => Number)
  @IsInt()
  @IsPositive()
  quantity!: number;

  /** SHIPPING_ADDED: required agreed line amount. SHIPPING_INCLUDED: optional allocation weight. */
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @IsOptional()
  lineAmount?: number;
}

/**
 * Pricing + fulfillment input shared by quote, direct order and lead
 * conversion (spec §5). The owner agent, agreement and snapshot are always
 * derived server-side.
 */
export class AgentOrderPricingDto {
  @IsIn(['SHIPPING_ADDED', 'SHIPPING_INCLUDED'])
  pricingMode!: 'SHIPPING_ADDED' | 'SHIPPING_INCLUDED';

  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(100)
  @ValidateNested({ each: true })
  @Type(() => AgentOrderLineDto)
  lines!: AgentOrderLineDto[];

  /** SHIPPING_INCLUDED: the agreed all-inclusive total the customer pays. */
  @ValidateIf(
    (dto: AgentOrderPricingDto) => dto.pricingMode === 'SHIPPING_INCLUDED',
  )
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  agreedTotal?: number;

  @IsIn(['SHIPPING', 'PICKUP'])
  @IsOptional()
  fulfillmentMethod?: 'SHIPPING' | 'PICKUP';

  @IsIn(['PREPAID', 'CASH_ON_DELIVERY'])
  @IsOptional()
  paymentType?: 'PREPAID' | 'CASH_ON_DELIVERY';

  /** Destination (SHIPPING orders with physical goods): selects the configured rate. */
  @IsOptionalUuid()
  countryId?: string;

  @Transform(emptyToUndefined)
  @IsString()
  @IsOptional()
  @MaxLength(120)
  city?: string;

  @Transform(emptyToUndefined)
  @IsString()
  @IsOptional()
  @MaxLength(500)
  address?: string;

  /**
   * A shipping charge different from the configured rate (or when no rate
   * exists). Needs `agent.orders.override_shipping` (agent users) or
   * `agents.edit` (internal) and a reason; audited on the order.
   */
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @IsOptional()
  shippingChargeOverride?: number;

  @Transform(emptyToUndefined)
  @IsString()
  @IsOptional()
  @MaxLength(500)
  shippingOverrideReason?: string;

  /** Separately agreed service charge (not shipping). */
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @IsOptional()
  serviceCharge?: number;

  /** Currency check only — must equal the agreement currency (D6). */
  @IsOptionalUuid()
  currencyId?: string;

  @IsDateString()
  @IsOptional()
  orderDate?: string;

  /** Internal staff only: which agent (must equal the lines' owner). Ignored for agent users. */
  @IsOptionalUuid()
  agentId?: string;
}

/** Payment declaration fields for agent orders (spec §6.2). */
export class AgentDeclarationFieldsDto {
  @IsIn(DECLARATION_KINDS)
  kind!: (typeof DECLARATION_KINDS)[number];

  @ValidateIf((dto: AgentDeclarationFieldsDto) => dto.kind === 'PARTIAL')
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0.01)
  amount?: number;

  /** The agent's authorized payment destination (required unless UNPAID). */
  @ValidateIf((dto: AgentDeclarationFieldsDto) => dto.kind !== 'UNPAID')
  @IsUUID()
  destinationId?: string;

  @ValidateIf((dto: AgentDeclarationFieldsDto) => dto.kind !== 'UNPAID')
  @IsDateString()
  paymentDate?: string;

  @Transform(emptyToUndefined)
  @IsString()
  @MaxLength(200)
  @IsOptional()
  reference?: string;

  @IsArray()
  @ArrayMaxSize(10)
  @IsUUID('4', { each: true })
  @IsOptional()
  stagedAttachmentIds?: string[];
}

/** Declaration with its client idempotency key (order create / order detail). */
export class AgentOrderDeclarationDto extends AgentDeclarationFieldsDto {
  @IsString()
  @MaxLength(100)
  idempotencyKey!: string;
}

/**
 * The agent's customer (S1) — deliberately narrow: no email, tax number,
 * commercial registration, roles or profiles. Anything else in the payload
 * is stripped by the global whitelist. It never updates a shared Partner.
 */
export class AgentCustomerDto {
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  name!: string;

  @Transform(emptyToUndefined)
  @IsString()
  @IsOptional()
  @MaxLength(40)
  mobile?: string;

  @IsOptionalUuid()
  countryId?: string;

  @Transform(emptyToUndefined)
  @IsString()
  @IsOptional()
  @MaxLength(120)
  city?: string;

  @Transform(emptyToUndefined)
  @IsString()
  @IsOptional()
  @MaxLength(500)
  address?: string;
}

export class CreateAgentOrderDto extends AgentOrderPricingDto {
  @ValidateNested()
  @Type(() => AgentCustomerDto)
  customer!: AgentCustomerDto;

  @Transform(emptyToUndefined)
  @IsString()
  @IsOptional()
  @MaxLength(2000)
  notes?: string;

  /** Internal staff only: the agent user who owns the order (default: the creator). */
  @IsOptionalUuid()
  ownerUserId?: string;

  /** Client key per submit — a retried submit returns the first order. */
  @IsString()
  @MaxLength(100)
  @IsOptional()
  idempotencyKey?: string;

  @ValidateNested()
  @Type(() => AgentOrderDeclarationDto)
  @IsOptional()
  declaration?: AgentOrderDeclarationDto;

  /** Round 5 Spec 1B — the answer to the duplicate customer warning. */
  @ValidateNested()
  @Type(() => DuplicateResolutionDto)
  @IsOptional()
  duplicateResolution?: DuplicateResolutionDto;
}

export class ConvertAgentLeadDto extends AgentOrderPricingDto {
  @Transform(emptyToUndefined)
  @IsString()
  @IsOptional()
  @MaxLength(2000)
  notes?: string;

  /** Idempotent per lead (the conversion itself is one-shot). */
  @ValidateNested()
  @Type(() => AgentDeclarationFieldsDto)
  @IsOptional()
  declaration?: AgentDeclarationFieldsDto;

  /** Round 5 Spec 1B — one key per form instance (the lead converts once regardless). */
  @IsString()
  @MaxLength(100)
  @IsOptional()
  idempotencyKey?: string;

  /** Spec 1B — the answer to the duplicate customer warning. */
  @ValidateNested()
  @Type(() => DuplicateResolutionDto)
  @IsOptional()
  duplicateResolution?: DuplicateResolutionDto;
}

export class DeclareAgentOrderPaymentDto extends AgentOrderDeclarationDto {}

/**
 * Spec 2 — "Customer agreed to pay {new total}". The total shown to the user
 * is echoed back so a re-resolution in between is never confirmed blindly.
 */
export class ConfirmCustomerTotalDto {
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  expectedPayableTotal!: number;
}
