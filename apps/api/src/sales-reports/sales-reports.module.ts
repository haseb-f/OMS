import { Module } from '@nestjs/common';
import { AgentPermissionGuard } from '../agents/common/agent-permission.guard';
import {
  AgentPortalSalesReportsController,
  SalesReportsController,
} from './sales-reports.controller';
import { SalesReportsService } from './sales-reports.service';

/**
 * R13 spec E — `/sales-reports/*` and `/agent-portal/sales-reports/*`.
 * Exports the service: the home dashboard (`/sales/performance`) reads its
 * figures and ranking through the same scope and metric definitions.
 */
@Module({
  controllers: [SalesReportsController, AgentPortalSalesReportsController],
  providers: [SalesReportsService, AgentPermissionGuard],
  exports: [SalesReportsService],
})
export class SalesReportsModule {}
