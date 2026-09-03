import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { WorkflowType } from '@prisma/client';
import { PermissionsResolverService } from '../permissions/permissions-resolver.service';
import { WorkflowEngineService } from './workflow-engine.service';
import {
  ExecuteWorkflowTransitionDto,
  RequestWorkflowApprovalDto,
} from './dto/execute-workflow-transition.dto';
import {
  CreateWorkflowTransitionDto,
  UpdateWorkflowTransitionDto,
} from './dto/workflow-transition.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { JwtPayload } from '../auth/guards/jwt-auth.guard';
import { isWorkflowEntityType } from './workflow.catalog';

@Controller('workflow')
@UseGuards(JwtAuthGuard)
export class WorkflowController {
  constructor(
    private readonly engine: WorkflowEngineService,
    private readonly permissions: PermissionsResolverService,
  ) {}

  // --- Static routes MUST precede :entityType/:entityId ---

  @Get('transitions')
  listTransitions(@Query('workflowType') workflowType?: WorkflowType) {
    return this.engine.listTransitions(workflowType);
  }

  @Post('transitions')
  createTransition(
    @Body() dto: CreateWorkflowTransitionDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.engine.createTransition(dto, user.sub);
  }

  @Patch('transitions/:id')
  updateTransition(
    @Param('id') id: string,
    @Body() dto: UpdateWorkflowTransitionDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.engine.updateTransition(id, dto, user.sub);
  }

  @Get('approvals/pending')
  pendingApprovals() {
    return this.engine.listPendingApprovals();
  }

  @Post('approvals/:approvalId/approve')
  approve(
    @Param('approvalId') approvalId: string,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.engine.approveTransition(approvalId, user.sub);
  }

  @Post('approvals/:approvalId/reject')
  reject(
    @Param('approvalId') approvalId: string,
    @Body() dto: RequestWorkflowApprovalDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.engine.rejectTransition(approvalId, user.sub, dto.reason);
  }

  @Get('analytics/lead-funnel')
  leadFunnel(
    @Query('dateFrom') dateFrom?: string,
    @Query('dateTo') dateTo?: string,
    @Query('source') source?: string,
    @Query('salesEmployeeId') salesEmployeeId?: string,
  ) {
    return this.engine.getLeadFunnel({
      dateFrom,
      dateTo,
      source,
      salesEmployeeId,
    });
  }

  @Get(':entityType/:entityId/available-actions')
  async availableActions(
    @Param('entityType') entityType: string,
    @Param('entityId') entityId: string,
    @CurrentUser() user: JwtPayload,
  ) {
    if (!isWorkflowEntityType(entityType)) {
      return [];
    }
    const isSuperAdmin = await this.permissions.isSuperAdmin(user.sub);
    return this.engine.getAvailableActions(
      entityType,
      entityId,
      user.sub,
      isSuperAdmin,
    );
  }

  @Get(':entityType/:entityId/status-history')
  statusHistory(
    @Param('entityType') entityType: string,
    @Param('entityId') entityId: string,
  ) {
    return this.engine.getStatusHistory(entityType, entityId);
  }

  @Post(':entityType/:entityId/transition')
  async transition(
    @Param('entityType') entityType: string,
    @Param('entityId') entityId: string,
    @Body() dto: ExecuteWorkflowTransitionDto,
    @CurrentUser() user: JwtPayload,
  ) {
    const isSuperAdmin = await this.permissions.isSuperAdmin(user.sub);
    return this.engine.executeTransition(
      entityType,
      entityId,
      dto.transitionId,
      user.sub,
      {
        reason: dto.reason,
        convertPayload: {
          productId: dto.productId,
          quantity: dto.quantity,
          unitPrice: dto.unitPrice,
          paymentType: dto.paymentType,
          notes: dto.notes,
        },
      },
      isSuperAdmin,
    );
  }
}
