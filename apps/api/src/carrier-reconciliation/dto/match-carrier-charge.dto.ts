import { IsNotEmpty, IsString, IsUUID, MaxLength } from 'class-validator';

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
