import { IsUUID } from 'class-validator';

export class AssignShippingEmployeeDto {
  @IsUUID()
  shippingEmployeeId!: string;
}
