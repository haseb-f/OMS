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
import { AccruedExpensesService } from './accrued-expenses.service';
import {
  CreateAccruedExpenseDto,
  SettleAccruedExpenseDto,
  UpdateAccruedExpenseDto,
} from './dto/accrued-expense.dto';
import { MasterDataQueryDto } from '../master-data/dto/master-data-query.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { PermissionsGuard } from '../auth/guards/permissions.guard';
import { PermissionModule } from '../auth/decorators/permission-module.decorator';
import { PermissionAction } from '../auth/decorators/permission-action.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { JwtPayload } from '../auth/guards/jwt-auth.guard';

@Controller('accrued-expenses')
@UseGuards(JwtAuthGuard, PermissionsGuard)
@PermissionModule('accrued-expenses')
export class AccruedExpensesController {
  constructor(private readonly accruedExpenses: AccruedExpensesService) {}

  @Post()
  create(
    @Body() dto: CreateAccruedExpenseDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.accruedExpenses.create(dto, user.sub);
  }

  @Get()
  findAll(@Query() query: MasterDataQueryDto) {
    return this.accruedExpenses.findAll(query);
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.accruedExpenses.findOne(id);
  }

  @Get(':id/activity')
  activity() {
    return [];
  }

  @Patch(':id')
  @PermissionAction('edit')
  update(
    @Param('id') id: string,
    @Body() dto: UpdateAccruedExpenseDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.accruedExpenses.update(id, dto, user.sub);
  }

  @Post(':id/recognize')
  @PermissionAction('edit')
  recognize(@Param('id') id: string, @CurrentUser() user: JwtPayload) {
    return this.accruedExpenses.recognize(id, user.sub);
  }

  @Post(':id/settle')
  @PermissionAction('edit')
  settle(
    @Param('id') id: string,
    @Body() dto: SettleAccruedExpenseDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.accruedExpenses.settle(id, dto, user.sub);
  }

  @Post(':id/archive')
  @PermissionAction('delete')
  archive(@Param('id') id: string, @CurrentUser() user: JwtPayload) {
    return this.accruedExpenses.archive(id, user.sub);
  }
}
