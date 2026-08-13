import { ArrayMinSize, IsArray, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';
import { AllocationInputDto } from '../../financial-transactions/shared/allocation-input.dto';
import { IsOptionalUuid } from '../../common/decorators/is-optional-uuid.decorator';

/** Shared by "Confirm Sales Invoice Receipt" (incoming) and "Confirm Purchase Invoice Payment" (outgoing) — one payment/receipt can cover multiple invoices (spec sections 7/10). */
export class ConfirmInvoiceAllocationDto {
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => AllocationInputDto)
  allocations!: AllocationInputDto[];

  @IsOptionalUuid()
  paymentSourceId?: string;
}
