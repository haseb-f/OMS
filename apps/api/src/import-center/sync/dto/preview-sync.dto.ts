import { Type } from 'class-transformer';
import { IsArray, IsBoolean, IsIn, IsInt, IsOptional } from 'class-validator';

/** Optional incremental-retry flags for Store Orders preview. Other source types ignore these. */
export class PreviewSyncDto {
  @IsOptional()
  @IsArray()
  @Type(() => Number)
  @IsInt({ each: true })
  retryRowNumbers?: number[];

  @IsOptional()
  @IsBoolean()
  retryAllFailed?: boolean;

  /**
   * Shipping Sync reuses the Store Orders Google Sheets source. The
   * preview still loads that config row, then runs the shipping handler.
   */
  @IsOptional()
  @IsIn(['SHIPPING_UPDATES'])
  runAs?: 'SHIPPING_UPDATES';
}
