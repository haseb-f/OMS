import {
  IsDateString,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Min,
} from 'class-validator';
import { IsOptionalUuid } from '../../common/decorators/is-optional-uuid.decorator';

/** Investor Engine Milestone 3, Phase 31 — Capital Return foundation; manual and controlled (Phase 35), never automatic. */
export class CreateCapitalReturnDto {
  @IsUUID()
  subscriptionId!: string;

  @IsNumber()
  @Min(0.01)
  amount!: number;

  @IsDateString()
  date!: string;

  @IsOptionalUuid()
  financialAccountId?: string;

  @IsString()
  @IsOptional()
  referenceNumber?: string;

  @IsString()
  @IsOptional()
  notes?: string;
}
