import { IsOptional, IsUUID } from 'class-validator';
import { FindFinancialTransactionsQueryDto } from '../../shared/find-financial-transactions-query.dto';

export class FindSupplierPaymentsQueryDto extends FindFinancialTransactionsQueryDto {
  @IsUUID()
  @IsOptional()
  supplierId?: string;
}
