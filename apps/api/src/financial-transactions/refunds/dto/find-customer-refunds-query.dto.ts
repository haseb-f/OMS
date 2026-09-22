import { FindFinancialTransactionsQueryDto } from '../../shared/find-financial-transactions-query.dto';
import { IsOptionalUuidList } from '../../../common/query/enum-list';
import { IsOptionalUuid } from '../../../common/decorators/is-optional-uuid.decorator';

export class FindCustomerRefundsQueryDto extends FindFinancialTransactionsQueryDto {
  @IsOptionalUuidList()
  partnerId?: string[];

  /** Only refunds paying back this Sales Return. */
  @IsOptionalUuid()
  salesReturnId?: string;
}
