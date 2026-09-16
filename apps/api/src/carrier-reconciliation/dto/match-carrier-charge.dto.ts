import { IsUUID } from 'class-validator';

export class MatchCarrierChargeDto {
  @IsUUID()
  shipmentId!: string;
}
