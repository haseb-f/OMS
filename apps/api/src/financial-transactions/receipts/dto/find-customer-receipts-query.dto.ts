import { FindFinancialTransactionsQueryDto } from '../../shared/find-financial-transactions-query.dto';
import { IsOptionalUuidList } from '../../../common/query/enum-list';

export class FindCustomerReceiptsQueryDto extends FindFinancialTransactionsQueryDto {
  @IsOptionalUuidList()
  partnerId?: string[];
}
