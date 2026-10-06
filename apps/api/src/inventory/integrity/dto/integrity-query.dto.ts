import { Transform } from 'class-transformer';
import { ArrayMaxSize, IsArray, IsOptional, IsUUID } from 'class-validator';
import { IsOptionalUuid } from '../../../common/decorators/is-optional-uuid.decorator';

/** `GET /inventory/integrity` — optional scope: `productIds` (comma-separated or repeated) and/or one `warehouseId`. */
export class IntegrityQueryDto {
  @Transform(({ value }: { value: unknown }): unknown => {
    if (value === undefined || value === null || value === '') return undefined;
    const list: unknown[] = Array.isArray(value)
      ? value
      : typeof value === 'string'
        ? value.split(',')
        : [value];
    const ids = list
      .map((v) => (typeof v === 'string' ? v.trim() : v))
      .filter((v) => v !== '');
    return ids.length > 0 ? ids : undefined;
  })
  @IsArray()
  @ArrayMaxSize(200)
  @IsUUID('all', { each: true })
  @IsOptional()
  productIds?: string[];

  @IsOptionalUuid()
  warehouseId?: string;
}
