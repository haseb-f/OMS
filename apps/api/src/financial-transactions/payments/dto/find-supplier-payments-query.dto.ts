import { FindFinancialTransactionsQueryDto } from '../../shared/find-financial-transactions-query.dto';
import { IsOptionalUuidList } from '../../../common/query/enum-list';

export class FindSupplierPaymentsQueryDto extends FindFinancialTransactionsQueryDto {
  @IsOptionalUuidList()
  supplierId?: string[];
}
