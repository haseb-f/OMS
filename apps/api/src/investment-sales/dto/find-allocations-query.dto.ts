import { Type } from 'class-transformer';
import { IsEnum, IsInt, IsOptional, IsUUID, Max, Min } from 'class-validator';
import { SaleAllocationStatus, SaleAllocationType } from '@prisma/client';

export class FindAllocationsQueryDto {
  @IsUUID()
  opportunityId!: string;

  @IsUUID()
  @IsOptional()
  productId?: string;

  @IsEnum(SaleAllocationType)
  @IsOptional()
  allocationType?: SaleAllocationType;

  @IsEnum(SaleAllocationStatus)
  @IsOptional()
  status?: SaleAllocationStatus;

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
