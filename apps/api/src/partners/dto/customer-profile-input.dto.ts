import { IsNumber, IsOptional, Min } from 'class-validator';
import { IsOptionalUuid } from '../../common/decorators/is-optional-uuid.decorator';

/** CUSTOMER-role configuration only — sent alongside CreatePartnerDto/UpdatePartnerDto when `roles` includes CUSTOMER. */
export class CustomerProfileInputDto {
  @IsOptionalUuid()
  customerGroupId?: string;

  @IsOptionalUuid()
  paymentTermId?: string;

  @IsNumber()
  @Min(0)
  @IsOptional()
  creditLimit?: number;
}
