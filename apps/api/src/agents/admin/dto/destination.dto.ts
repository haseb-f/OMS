import { Transform } from 'class-transformer';
import {
  IsEnum,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
} from 'class-validator';
import { AgentDestinationOwnership } from '@prisma/client';
import { emptyToUndefined } from '../../../common/transforms/empty-to-undefined';

export class CreatePaymentDestinationDto {
  @IsUUID()
  paymentMethodId!: string;

  /** COMPANY = our account/provider; AGENT = straight to the agent (agreement must allow it). */
  @IsEnum(AgentDestinationOwnership)
  ownership!: AgentDestinationOwnership;

  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  label!: string;

  /** Account details shown to the agent's customers. */
  @Transform(emptyToUndefined)
  @IsString()
  @IsOptional()
  @MaxLength(1000)
  details?: string;
}
