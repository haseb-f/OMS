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
import { EmployeesService } from './employees.service';
import { CreateEmployeeDto } from './dto/create-employee.dto';
import { UpdateEmployeeDto } from './dto/update-employee.dto';
import { RecordCompensationDto } from './dto/record-compensation.dto';
import { CreateEmployeeAccountDto } from './dto/create-employee-account.dto';
import { EmployeesQueryDto } from './dto/employees-query.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { PermissionsGuard } from '../auth/guards/permissions.guard';
import { PermissionModule } from '../auth/decorators/permission-module.decorator';
import {
  PermissionAction,
  SkipPermissionCheck,
} from '../auth/decorators/permission-action.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { JwtPayload } from '../auth/guards/jwt-auth.guard';

/** HR Milestone 1, Part C-G — Employee (the HR person record), distinct from User. */
@Controller('employees')
@UseGuards(JwtAuthGuard, PermissionsGuard)
@PermissionModule('employees')
export class EmployeesController {
  constructor(private readonly employeesService: EmployeesService) {}

  /** My Profile — unguarded, same convention as every other self-view (Part AG "Employee: view only authorized personal data"). */
  @Get('me')
  @SkipPermissionCheck()
  findMe(@CurrentUser() user: JwtPayload) {
    return this.employeesService.findMe(user.sub);
  }

  @Post()
  create(@Body() dto: CreateEmployeeDto, @CurrentUser() user: JwtPayload) {
    return this.employeesService.create(dto, user.sub);
  }

  @Get()
  findAll(@Query() query: EmployeesQueryDto) {
    return this.employeesService.findAll(query);
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.employeesService.findOne(id);
  }

  @Get(':id/activity')
  activity(@Param('id') id: string) {
    return this.employeesService.activityFor(id);
  }

  @Patch(':id')
  update(
    @Param('id') id: string,
    @Body() dto: UpdateEmployeeDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.employeesService.update(id, dto, user.sub);
  }

  @Post(':id/archive')
  @PermissionAction('delete')
  archive(@Param('id') id: string, @CurrentUser() user: JwtPayload) {
    return this.employeesService.archive(id, user.sub);
  }

  @Post(':id/restore')
  restore(@Param('id') id: string, @CurrentUser() user: JwtPayload) {
    return this.employeesService.restore(id, user.sub);
  }

  @Post(':id/account')
  createAccount(
    @Param('id') id: string,
    @Body() dto: CreateEmployeeAccountDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.employeesService.createAccountForEmployee(id, dto, user.sub);
  }

  // -- Compensation (Part G) — its own permission module (hr.compensation). --

  @Get(':id/compensation')
  @PermissionModule('compensation')
  compensationHistory(@Param('id') id: string) {
    return this.employeesService.compensationHistory(id);
  }

  @Post(':id/compensation')
  @PermissionModule('compensation')
  @PermissionAction('create')
  recordCompensation(
    @Param('id') id: string,
    @Body() dto: RecordCompensationDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.employeesService.recordCompensation(id, dto, user.sub);
  }

  @Patch('compensation/:revisionId')
  @PermissionModule('compensation')
  @PermissionAction('edit')
  updateCompensationRevision(
    @Param('revisionId') revisionId: string,
    @Body() dto: RecordCompensationDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.employeesService.updateCompensationRevision(
      revisionId,
      dto,
      user.sub,
    );
  }
}
