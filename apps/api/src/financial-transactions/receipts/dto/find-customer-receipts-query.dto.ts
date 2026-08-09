import { IsOptional, IsUUID } from 'class-validator';
import { FindFinancialTransactionsQueryDto } from '../../shared/find-financial-transactions-query.dto';

export class FindCustomerReceiptsQueryDto extends FindFinancialTransactionsQueryDto {
  @IsUUID()
  @IsOptional()
  customerId?: string;
}
