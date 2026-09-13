import { IsUUID } from 'class-validator';

export class StartSettlementDto {
  @IsUUID()
  opportunityId!: string;
}
