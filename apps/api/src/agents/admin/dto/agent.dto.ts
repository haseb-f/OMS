import { PartialType, OmitType } from '@nestjs/mapped-types';
import { Transform, Type } from 'class-transformer';
import {
  IsIn,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { IsOptionalUuid } from '../../../common/decorators/is-optional-uuid.decorator';
import { IsOptionalEmail } from '../../../common/decorators/is-optional-email.decorator';
import { emptyToUndefined } from '../../../common/transforms/empty-to-undefined';

/** Agent profile (spec §2). `agentNumber` and the Partner are server-made. */
export class CreateAgentDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  name!: string;

  @Transform(emptyToUndefined)
  @IsString()
  @IsOptional()
  @MaxLength(200)
  legalName?: string;

  @Transform(emptyToUndefined)
  @IsString()
  @IsOptional()
  @MaxLength(200)
  contactName?: string;

  @Transform(emptyToUndefined)
  @IsString()
  @IsOptional()
  phone?: string;

  @IsOptionalEmail()
  email?: string | null;

  @Transform(emptyToUndefined)
  @IsString()
  @IsOptional()
  address?: string;

  /** Phone normalization context for the agent's Partner identity. */
  @IsOptionalUuid()
  countryId?: string;

  @Transform(emptyToUndefined)
  @IsString()
  @IsOptional()
  notes?: string;

  /** Settlement currency: agreements, orders, ledger and payouts use it (D6). */
  @IsUUID()
  currencyId!: string;
}

export class UpdateAgentDto extends PartialType(
  OmitType(CreateAgentDto, ['countryId'] as const),
) {}

export class FindAgentsQueryDto {
  @IsString()
  @IsOptional()
  search?: string;

  @IsIn(['ACTIVE', 'INACTIVE'])
  @IsOptional()
  status?: 'ACTIVE' | 'INACTIVE';

  @Type(() => Number)
  @IsInt()
  @Min(1)
  @IsOptional()
  page?: number = 1;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(200)
  @IsOptional()
  pageSize?: number = 20;
}

export class AgentStockQueryDto {
  @IsOptionalUuid()
  productId?: string;

  @IsOptionalUuid()
  warehouseId?: string;
}
