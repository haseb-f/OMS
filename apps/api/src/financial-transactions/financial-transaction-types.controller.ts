import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { IsIn, IsOptional } from 'class-validator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { PermissionsGuard } from '../auth/guards/permissions.guard';
import { SkipPermissionCheck } from '../auth/decorators/permission-action.decorator';
import {
  FINANCIAL_TRANSACTION_TYPE_CATALOG,
  type FinancialTransactionDirection,
  typesForDirection,
} from './financial-transaction-type.catalog';

class FindFinancialTransactionTypesQueryDto {
  @IsOptional()
  @IsIn(['IN', 'OUT'])
  direction?: FinancialTransactionDirection;
}

/** Closed catalog — authenticated read, not a CRUD master-data table. */
@Controller('financial-transactions/types')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class FinancialTransactionTypesController {
  @Get()
  @SkipPermissionCheck()
  list(@Query() query: FindFinancialTransactionTypesQueryDto) {
    const catalog = query.direction
      ? typesForDirection(query.direction)
      : FINANCIAL_TRANSACTION_TYPE_CATALOG;
    return catalog.map((type) => ({
      code: type.code,
      label: type.label,
      direction: type.direction,
      isSystem: type.isSystem,
    }));
  }
}
