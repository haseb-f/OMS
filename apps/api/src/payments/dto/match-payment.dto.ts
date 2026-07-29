import { IsUUID } from 'class-validator';

export class MatchPaymentDto {
  @IsUUID()
  matchedById!: string;
}
