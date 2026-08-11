import { IsBoolean, IsNotEmpty, IsOptional, IsString } from 'class-validator';
import { IsOptionalUuid } from '../../common/decorators/is-optional-uuid.decorator';

/** Code is never accepted from the client — minted by the Numbering Engine (TASK-030). */
export class CreateWarehouseDto {
  @IsString()
  @IsNotEmpty()
  name!: string;

  @IsString()
  @IsOptional()
  description?: string;

  @IsBoolean()
  @IsOptional()
  isDefault?: boolean;

  /** No closed set of values specified — free-text classifier. */
  @IsString()
  @IsOptional()
  warehouseType?: string;

  @IsBoolean()
  @IsOptional()
  isActive?: boolean;

  /** Future warehouse hierarchy — prepared only, no depth/cycle validation. */
  @IsOptionalUuid()
  parentWarehouseId?: string;

  /** The user responsible for this warehouse (TASK-028 Part 3). */
  @IsOptionalUuid()
  managerId?: string;

  /** Analytic account this warehouse's inventory activity defaults to (TASK-028 Part 3). */
  @IsOptionalUuid()
  defaultAnalyticAccountId?: string;
}
