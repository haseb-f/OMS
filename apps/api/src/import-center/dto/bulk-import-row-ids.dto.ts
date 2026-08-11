import { ArrayMaxSize, ArrayMinSize, IsArray, IsString } from 'class-validator';

/** Bulk confirm/reject for needs-review Import rows — ids are `ImportJobError.id` values, same "bulk body shape" convention as `BulkIdsDto`. */
export class BulkImportRowIdsDto {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(1000)
  @IsString({ each: true })
  rowIds!: string[];
}
