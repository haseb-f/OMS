import {
  IsBoolean,
  IsNotEmpty,
  IsNumber,
  IsObject,
  IsOptional,
} from 'class-validator';

/**
 * Generic attribute bag (`{"color":"Red","size":"L"}`) — no fixed
 * attribute/value schema, matching the "prepared architecture, not a full
 * combination-matrix engine" scope for TASK-027 variants. `sku` is minted
 * by ProductVariantsService via the same Numbering Engine series as the
 * parent product, never supplied by the client.
 */
export class CreateProductVariantDto {
  @IsObject()
  @IsNotEmpty()
  attributes!: Record<string, string>;

  @IsNumber()
  @IsOptional()
  priceAdjustment?: number;

  @IsBoolean()
  @IsOptional()
  active?: boolean;
}
