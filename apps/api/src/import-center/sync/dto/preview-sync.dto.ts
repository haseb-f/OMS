import { Type } from 'class-transformer';
import { IsArray, IsBoolean, IsInt, IsOptional } from 'class-validator';

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
}
