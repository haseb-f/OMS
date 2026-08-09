import { IsArray, IsOptional, IsString, IsUUID } from 'class-validator';

/** Omit `productIds` to count every active inventory item stocked at the warehouse. */
export class CreatePhysicalCountDto {
  @IsUUID()
  warehouseId!: string;

  @IsArray()
  @IsUUID('4', { each: true })
  @IsOptional()
  productIds?: string[];

  @IsString()
  @IsOptional()
  notes?: string;
}
