import { IsNotEmpty, IsOptional, IsString } from 'class-validator';
import { IsOptionalUuid } from '../../common/decorators/is-optional-uuid.decorator';

/** Account-mapping fields are TASK-047 (Accounting Configuration) — optional overrides of the Accounting Settings defaults. */
export class CreateSupplierGroupDto {
  @IsString()
  @IsNotEmpty()
  code!: string;

  @IsString()
  @IsNotEmpty()
  name!: string;

  @IsString()
  @IsOptional()
  description?: string;

  @IsOptionalUuid()
  defaultPayableAccountId?: string;

  @IsOptionalUuid()
  defaultPurchaseAccountId?: string;
}
