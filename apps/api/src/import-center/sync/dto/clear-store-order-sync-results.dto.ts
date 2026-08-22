import { ArrayNotEmpty, IsArray, IsInt, Min } from 'class-validator';
import { Type } from 'class-transformer';

/** Clears OMS-only Store Orders sync result columns Q:R:S for selected sheet rows. */
export class ClearStoreOrderSyncResultsDto {
  @IsArray()
  @ArrayNotEmpty()
  @Type(() => Number)
  @IsInt({ each: true })
  @Min(2, { each: true })
  rowNumbers!: number[];
}
