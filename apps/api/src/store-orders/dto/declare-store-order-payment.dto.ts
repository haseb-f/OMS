import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsDateString,
  IsIn,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  Min,
  ValidateIf,
} from 'class-validator';
import { IsOptionalUuid } from '../../common/decorators/is-optional-uuid.decorator';
import { emptyToUndefined } from '../../common/transforms/empty-to-undefined';

export const DECLARATION_KINDS = ['UNPAID', 'FULL', 'PARTIAL'] as const;

/**
 * Fields shared by every payment declaration entry point (order detail,
 * order create, lead conversion). Sales never supplies an account or — for
 * FULL — an amount: the server derives it from the validated order total.
 */
export class PaymentDeclarationFieldsDto {
  @IsIn(DECLARATION_KINDS)
  kind!: (typeof DECLARATION_KINDS)[number];

  /** PARTIAL only; > 0 and ≤ the remaining declarable amount. Ignored for FULL. */
  @ValidateIf((dto: PaymentDeclarationFieldsDto) => dto.kind === 'PARTIAL')
  @Type(() => Number)
  @IsNumber()
  @Min(0.01)
  amount?: number;

  /** Required unless UNPAID (or an agent destination is given); must be an active Payment Method. */
  @ValidateIf(
    (dto: PaymentDeclarationFieldsDto) =>
      dto.kind !== 'UNPAID' && !dto.agentPaymentDestinationId,
  )
  @IsUUID()
  paymentMethodId?: string;

  /** Agent orders only (spec §7): the agent's authorized payment destination. */
  @IsOptionalUuid()
  agentPaymentDestinationId?: string;

  /** Must equal the order currency. */
  @IsOptionalUuid()
  currencyId?: string;

  /** Actual payment date — required unless UNPAID; never in the future. */
  @ValidateIf((dto: PaymentDeclarationFieldsDto) => dto.kind !== 'UNPAID')
  @IsDateString()
  paymentDate?: string;

  @Transform(emptyToUndefined)
  @IsString()
  @MaxLength(200)
  @IsOptional()
  referenceNumber?: string;

  @IsArray()
  @ArrayMaxSize(10)
  @IsUUID('4', { each: true })
  @IsOptional()
  stagedAttachmentIds?: string[];
}

export class DeclareStoreOrderPaymentDto extends PaymentDeclarationFieldsDto {
  /** Client-generated UUID per dialog open; also accepted as the `Idempotency-Key` header. */
  @IsString()
  @MaxLength(100)
  @IsOptional()
  idempotencyKey?: string;
}

/** Optional declaration recorded atomically with a new Store Order. */
export class CreateOrderPaymentDeclarationDto extends PaymentDeclarationFieldsDto {
  @IsString()
  @MaxLength(100)
  idempotencyKey!: string;
}
