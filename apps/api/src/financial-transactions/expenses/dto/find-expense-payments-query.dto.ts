import { IsOptionalUuidList } from '../../../common/query/enum-list';
import { FindFinancialTransactionsQueryDto } from '../../shared/find-financial-transactions-query.dto';

/** Expenses list: status / date range (expense date) / account / paid from / counterparty. */
export class FindExpensePaymentsQueryDto extends FindFinancialTransactionsQueryDto {
  @IsOptionalUuidList()
  expenseAccountId?: string[];

  @IsOptionalUuidList()
  receivingAccountId?: string[];

  @IsOptionalUuidList()
  partnerId?: string[];
}
