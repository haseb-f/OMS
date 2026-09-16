import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsDateString,
  IsIn,
  IsOptional,
  IsString,
  IsUUID,
  ValidateNested,
} from 'class-validator';
import { CostAllocationMethod } from '@prisma/client';
import { CreateLandedCostLineDto } from './create-landed-cost-line.dto';

/** M1 only supports the two required methods — EQUAL/MANUAL are reserved schema-wise but rejected here until a later milestone implements them. */
export const SUPPORTED_ALLOCATION_METHODS: CostAllocationMethod[] = [
  CostAllocationMethod.BY_QUANTITY,
  CostAllocationMethod.BY_COST,
];

export class CreateLandedCostDocumentDto {
  @IsUUID()
  purchaseInvoiceId!: string;

  @IsUUID()
  @IsOptional()
  providerId?: string;

  @IsUUID()
  currencyId!: string;

  @IsString()
  @IsOptional()
  referenceNumber?: string;

  @IsDateString()
  documentDate!: string;

  @IsIn(SUPPORTED_ALLOCATION_METHODS)
  allocationMethod!: CostAllocationMethod;

  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => CreateLandedCostLineDto)
  lines!: CreateLandedCostLineDto[];
}
