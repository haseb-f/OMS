import { FindFinancialTransactionsQueryDto } from '../../shared/find-financial-transactions-query.dto';
import { IsOptionalUuid } from '../../../common/decorators/is-optional-uuid.decorator';

export class FindCustomerReceiptsQueryDto extends FindFinancialTransactionsQueryDto {
  @IsOptionalUuid()
  customerId?: string;
}
