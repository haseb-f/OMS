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
import { PrepaidExpensesService } from './prepaid-expenses.service';
import {
  CreatePrepaidExpenseDto,
  RecognizePrepaidDto,
  UpdatePrepaidExpenseDto,
} from './dto/prepaid-expense.dto';
import { MasterDataQueryDto } from '../master-data/dto/master-data-query.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { PermissionsGuard } from '../auth/guards/permissions.guard';
import { PermissionModule } from '../auth/decorators/permission-module.decorator';
import { PermissionAction } from '../auth/decorators/permission-action.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { JwtPayload } from '../auth/guards/jwt-auth.guard';

@Controller('prepaid-expenses')
@UseGuards(JwtAuthGuard, PermissionsGuard)
@PermissionModule('prepaid-expenses')
export class PrepaidExpensesController {
  constructor(private readonly prepaidExpenses: PrepaidExpensesService) {}

  @Post()
  create(
    @Body() dto: CreatePrepaidExpenseDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.prepaidExpenses.create(dto, user.sub);
  }

  @Post('recognize')
  @PermissionAction('edit')
  recognize(@Body() dto: RecognizePrepaidDto, @CurrentUser() user: JwtPayload) {
    return this.prepaidExpenses.recognize(dto, user.sub);
  }

  @Get()
  findAll(@Query() query: MasterDataQueryDto) {
    return this.prepaidExpenses.findAll(query);
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.prepaidExpenses.findOne(id);
  }

  @Get(':id/activity')
  activity() {
    return [];
  }

  @Patch(':id')
  @PermissionAction('edit')
  update(
    @Param('id') id: string,
    @Body() dto: UpdatePrepaidExpenseDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.prepaidExpenses.update(id, dto, user.sub);
  }

  @Post(':id/activate')
  @PermissionAction('edit')
  activate(@Param('id') id: string, @CurrentUser() user: JwtPayload) {
    return this.prepaidExpenses.activate(id, user.sub);
  }

  @Post(':id/archive')
  @PermissionAction('delete')
  archive(@Param('id') id: string, @CurrentUser() user: JwtPayload) {
    return this.prepaidExpenses.archive(id, user.sub);
  }
}
