import { DepreciationMethod } from '@prisma/client';
import {
  IsDateString,
  IsEnum,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  Min,
} from 'class-validator';
import { IsOptionalUuid } from '../../common/decorators/is-optional-uuid.decorator';
import { CreateFixedAssetDto } from './create-fixed-asset.dto';
import { PartialType } from '@nestjs/mapped-types';

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
  @IsNumber()
  @Min(0)
  @IsOptional()
  disposalAmount?: number;

  @IsOptionalUuid()
  receivingAccountId?: string;

  @IsString()
  @IsOptional()
  disposalNotes?: string;
}

export class RunDepreciationDto {
  @IsDateString()
  @IsOptional()
  asOf?: string;
}
