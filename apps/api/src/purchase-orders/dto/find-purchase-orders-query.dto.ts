import { IsEnum, IsOptional, IsString, IsUUID } from 'class-validator';
import { PurchaseOrderStatus, PurchaseType } from '@prisma/client';

export class FindPurchaseOrdersQueryDto {
  @IsUUID()
  @IsOptional()
  supplierId?: string;

  @IsEnum(PurchaseOrderStatus)
  @IsOptional()
  status?: PurchaseOrderStatus;

  @IsEnum(PurchaseType)
  @IsOptional()
  purchaseType?: PurchaseType;

  /** Matches against PO Number or Reference Number (case-insensitive, partial). */
  @IsString()
  @IsOptional()
  search?: string;
}
