import { IsEnum, IsOptional } from 'class-validator';
import { SupplierStatus } from '@prisma/client';
import { MasterDataQueryDto } from '../../master-data/dto/master-data-query.dto';

/**
 * TASK-048 — extends the shared Master Data query shape (search/page/
 * pageSize/sortBy/sortOrder/includeArchived) so `GET /suppliers` returns the
 * same `{items,total,page,pageSize}` envelope every other paginated list
 * endpoint does (SupplierPicker/EnterpriseDataTable both depend on it) —
 * `search` still matches against Code/Name/Commercial Name, same as before.
 */
export class FindSuppliersQueryDto extends MasterDataQueryDto {
  @IsEnum(SupplierStatus)
  @IsOptional()
  status?: SupplierStatus;
}
