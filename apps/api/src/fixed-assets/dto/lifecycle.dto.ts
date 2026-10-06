import { DepreciationMethod } from '@prisma/client';
import {
  IsDateString,
  IsEnum,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Min,
} from 'class-validator';
import { IsOptionalUuid } from '../../common/decorators/is-optional-uuid.decorator';
import { CreateFixedAssetDto } from './create-fixed-asset.dto';
import { PartialType } from '@nestjs/mapped-types';
import { Type } from 'class-transformer';

export class UpdateFixedAssetDto extends PartialType(CreateFixedAssetDto) {
  @IsInt()
  @Min(1)
  @IsOptional()
  usefulLifeMonths?: number;

  @IsNumber()
  @Min(0)
  @IsOptional()
  salvageValue?: number;

  @IsDateString()
  @IsOptional()
  depreciationStartDate?: string;

  @IsOptionalUuid()
  receivingAccountId?: string;

  @IsOptionalUuid()
  partnerId?: string;
}

export class CapitalizeFixedAssetDto {
  @IsInt()
  @Min(1)
  usefulLifeMonths!: number;

  @IsEnum(DepreciationMethod)
  @IsOptional()
  depreciationMethod?: DepreciationMethod;

  @IsNumber()
  @Min(0)
  @IsOptional()
  salvageValue?: number;

  @IsDateString()
  @IsOptional()
  depreciationStartDate?: string;

  @IsOptionalUuid()
  receivingAccountId?: string;

  @IsOptionalUuid()
  partnerId?: string;
}

export class DisposeFixedAssetDto {
  /** Business date of the disposal ("YYYY-MM-DD"); defaults to today (Africa/Cairo). Never in the future. */
  @IsDateString()
  @IsOptional()
  disposalDate?: string;

  @IsNumber()
  @Min(0)
  @IsOptional()
  disposalAmount?: number;

  @IsOptionalUuid()
  receivingAccountId?: string;

  /**
   * R13b (O-1) — proceeds settled as a supplier credit (e.g. an asset with
   * posted depreciation going back to its supplier): the disposal entry
   * debits this partner's payable instead of a receiving account. Exclusive
   * with `receivingAccountId`; requires `disposalAmount` > 0.
   */
  @IsOptionalUuid()
  counterpartyPartnerId?: string;

  @IsString()
  @IsOptional()
  disposalNotes?: string;
}

export class RunDepreciationDto {
  @IsDateString()
  @IsOptional()
  asOf?: string;
}

/** Parameters of a depreciation schedule preview (unsaved form or overrides on a saved asset). */
export class DepreciationPreviewParamsDto {
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @IsOptional()
  usefulLifeMonths?: number;

  @IsEnum(DepreciationMethod)
  @IsOptional()
  depreciationMethod?: DepreciationMethod;

  @Type(() => Number)
  @IsNumber()
  @Min(0)
  @IsOptional()
  salvageValue?: number;

  @IsDateString()
  @IsOptional()
  depreciationStartDate?: string;
}

/** Unsaved-form preview: every input the schedule needs. */
export class DepreciationPreviewDto {
  @IsNumber()
  @Min(0)
  cost!: number;

  @IsInt()
  @Min(1)
  usefulLifeMonths!: number;

  @IsEnum(DepreciationMethod)
  @IsOptional()
  depreciationMethod?: DepreciationMethod;

  @IsNumber()
  @Min(0)
  @IsOptional()
  salvageValue?: number;

  @IsDateString()
  depreciationStartDate!: string;
}

export class LinkInvoiceLineDto {
  @IsUUID()
  purchaseInvoiceItemId!: string;
}
