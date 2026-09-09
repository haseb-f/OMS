import { Body, Controller, Get, Param, Post, UseGuards } from '@nestjs/common';
import { PayrollService } from './payroll.service';
import { CreatePayrollRunDto } from './dto/create-payroll-run.dto';
import { AddPayrollLineComponentDto } from './dto/add-payroll-line-component.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { PermissionsGuard } from '../auth/guards/permissions.guard';
import { PermissionModule } from '../auth/decorators/permission-module.decorator';
import { PermissionAction } from '../auth/decorators/permission-action.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { JwtPayload } from '../auth/guards/jwt-auth.guard';

/** Part Y-AC — Monthly Payroll Runs: DRAFT → HR_REVIEWED → FINANCE_APPROVED → POSTED → PAID. */
@Controller('payroll')
@UseGuards(JwtAuthGuard, PermissionsGuard)
@PermissionModule('payroll')
export class PayrollController {
  constructor(private readonly service: PayrollService) {}

  @Post()
  createRun(@Body() dto: CreatePayrollRunDto, @CurrentUser() user: JwtPayload) {
    return this.service.createRun(dto, user.sub);
  }

  @Get()
  findAll() {
    return this.service.findAll();
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.service.findOne(id);
  }

  @Post(':id/recalculate')
  @PermissionAction('edit')
  recalculate(@Param('id') id: string) {
    return this.service.recalculate(id);
  }

  @Post('lines/:lineId/components')
  @PermissionAction('edit')
  addLineComponent(
    @Param('lineId') lineId: string,
    @Body() dto: AddPayrollLineComponentDto,
  ) {
    return this.service.addLineComponent(lineId, dto);
  }

  @Post(':id/hr-review')
  @PermissionAction('confirm')
  hrReview(@Param('id') id: string, @CurrentUser() user: JwtPayload) {
    return this.service.hrReview(id, user.sub);
  }

  @Post(':id/finance-approve')
  @PermissionAction('approve')
  financeApprove(@Param('id') id: string, @CurrentUser() user: JwtPayload) {
    return this.service.financeApprove(id, user.sub);
  }

  @Post(':id/post')
  @PermissionAction('post')
  post(@Param('id') id: string, @CurrentUser() user: JwtPayload) {
    return this.service.post(id, user.sub);
  }

  @Post(':id/pay')
  @PermissionAction('manage')
  pay(@Param('id') id: string, @CurrentUser() user: JwtPayload) {
    return this.service.pay(id, user.sub);
  }
}
