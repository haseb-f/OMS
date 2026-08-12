import { IsNotEmpty, IsString } from 'class-validator';

/** The exact `jobId` a prior `POST .../preview` returned — commit never runs a job the caller hasn't first previewed. */
export class CommitSyncDto {
  @IsString()
  @IsNotEmpty()
  jobId!: string;
}
