import { PartialType } from '@nestjs/mapped-types';
import { CreatePayrollComponentDto } from './create-payroll-component.dto';

export class UpdatePayrollComponentDto extends PartialType(
  CreatePayrollComponentDto,
) {}
