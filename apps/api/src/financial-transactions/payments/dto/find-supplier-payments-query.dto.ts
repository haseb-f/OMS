import { FindFinancialTransactionsQueryDto } from '../../shared/find-financial-transactions-query.dto';
import { IsOptionalUuid } from '../../../common/decorators/is-optional-uuid.decorator';

export class FindSupplierPaymentsQueryDto extends FindFinancialTransactionsQueryDto {
  @IsOptionalUuid()
  supplierId?: string;
}
