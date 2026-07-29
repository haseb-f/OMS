import { IsEnum, IsOptional, IsString } from 'class-validator';
import { SupplierStatus } from '@prisma/client';

export class FindSuppliersQueryDto {
  /** Matches against Code, Name, or Commercial Name (case-insensitive, partial). */
  @IsString()
  @IsOptional()
  search?: string;

  @IsEnum(SupplierStatus)
  @IsOptional()
  status?: SupplierStatus;
}
