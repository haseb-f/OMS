import {
  IsBoolean,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
} from 'class-validator';

export class MatchCarrierChargeDto {
  @IsUUID()
  shipmentId!: string;
}

export class MarkCarrierChargePaidDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  reference!: string;
}

/**
 * Optimistic guard for bulk confirm: the Shipment the user reviewed. When
 * sent, confirming is refused if the charge was rematched meanwhile.
 */
export class ConfirmCarrierChargeDto {
  @IsOptional()
  @IsUUID()
  expectedShipmentId?: string;
}

/**
 * `proposedOnly` (bulk "reject match"): refuse to unmatch a CONFIRMED
 * charge — reversing an approved actual cost stays a deliberate row action.
 */
export class UnmatchCarrierChargeDto {
  @IsOptional()
  @IsBoolean()
  proposedOnly?: boolean;
}
