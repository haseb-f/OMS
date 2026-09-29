import { BULK_LIMITS } from '../../common/bulk/bulk-limits';
import { ArrayMaxSize, ArrayMinSize, IsArray, IsUUID } from 'class-validator';

/** Shared body shape for every "bulk" endpoint that acts on an explicit set of rows — same pattern as Leads bulk-assign and Fiscal Period bulk-close/open. */
export class BulkIdsDto {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(BULK_LIMITS.bulkArchiveMax)
  @IsUUID('4', { each: true })
  ids!: string[];
}
