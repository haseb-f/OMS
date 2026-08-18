import { Type } from 'class-transformer';
import {
  IsArray,
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
}
