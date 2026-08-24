import { Type } from 'class-transformer';
import {
  IsArray,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
} from 'class-validator';

/** The exact `jobId` a prior `POST .../preview` returned — commit never runs a job the caller hasn't first previewed. */
export class CommitSyncDto {
  @IsString()
  @IsNotEmpty()
  jobId!: string;

  /**
   * Sheet row numbers the user accepted in the review UI.
   * Omit to keep the previous "import every importable row" behavior.
   * An empty array means import nothing.
   */
  @IsOptional()
  @IsArray()
  @Type(() => Number)
  @IsInt({ each: true })
  acceptRowNumbers?: number[];

  /**
   * Sheet row numbers the user EXPLICITLY chose "رفض" on — a
   * PHONE_MATCH_REVIEW row absent from both this and `acceptRowNumbers`
   * stays untouched/pending, never silently rejected.
   */
  @IsOptional()
  @IsArray()
  @Type(() => Number)
  @IsInt({ each: true })
  rejectRowNumbers?: number[];

  /** Same `runAs` the matching preview used — required when Shipping Sync reuses a Store Orders source. */
  @IsOptional()
  @IsIn(['SHIPPING_UPDATES'])
  runAs?: 'SHIPPING_UPDATES';
}
