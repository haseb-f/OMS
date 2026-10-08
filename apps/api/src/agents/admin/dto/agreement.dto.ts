import { PartialType } from '@nestjs/mapped-types';
import { Transform, Type } from 'class-transformer';
import {
  IsBoolean,
  IsDateString,
  IsEnum,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import {
  AgentChargeOwner,
  AgentCommissionEarningEvent,
  AgentReturnCommissionTreatment,
  AgentShippingPolicy,
} from '@prisma/client';
import { IsOptionalUuid } from '../../../common/decorators/is-optional-uuid.decorator';
import { emptyToUndefined } from '../../../common/transforms/empty-to-undefined';

/**
 * Agreement terms (spec §2, decision D3) — every term is entered explicitly;
 * the system applies no default rate, event, owner or fee.
 */
export class CreateAgreementDto {
  @IsDateString()
  effectiveFrom!: string;

  /** Inclusive; omitted = open-ended. */
  @Transform(emptyToUndefined)
  @IsDateString()
  @IsOptional()
  effectiveTo?: string;

  /** Defaults to the agent's settlement currency and must equal it. */
  @IsOptionalUuid()
  currencyId?: string;

  /** Default rate for physical products (inventory items) — commission-policy.md A3. */
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 4 })
  @Min(0)
  @Max(100)
  productCommissionRatePercent!: number;

  /** Default rate for services / courses (non-inventory items). */
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 4 })
  @Min(0)
  @Max(100)
  serviceCommissionRatePercent!: number;

  @IsEnum(AgentShippingPolicy)
  shippingPolicy!: AgentShippingPolicy;

  @IsEnum(AgentCommissionEarningEvent)
  commissionEarningEvent!: AgentCommissionEarningEvent;

  @IsEnum(AgentReturnCommissionTreatment)
  returnCommissionTreatment!: AgentReturnCommissionTreatment;

  @IsEnum(AgentChargeOwner)
  customerShippingChargeOwner!: AgentChargeOwner;

  @IsEnum(AgentChargeOwner)
  providerFeesBorneBy!: AgentChargeOwner;

  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  shippingFeePerShipment!: number;

  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  returnFeePerShipment!: number;

  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  serviceFeePerOrder!: number;

  @IsBoolean()
  allowAgentDestinations!: boolean;

  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(3650)
  payoutHoldDays!: number;

  @Transform(emptyToUndefined)
  @IsString()
  @IsOptional()
  @MaxLength(2000)
  notes?: string;
}

/** DRAFT agreements only. */
export class UpdateAgreementDto extends PartialType(CreateAgreementDto) {}

export class EndAgreementDto {
  /** Last day the agreement applies (inclusive); defaults to today. */
  @Transform(emptyToUndefined)
  @IsDateString()
  @IsOptional()
  effectiveTo?: string;
}

/** Sample amounts for the agreement preview (defaults: the owner's A1 example). */
export class AgreementPreviewQueryDto {
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @IsOptional()
  productSales?: number;

  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @IsOptional()
  serviceSales?: number;

  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @IsOptional()
  customerShipping?: number;
}
