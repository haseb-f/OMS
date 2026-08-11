import { IsUUID } from 'class-validator';

export class AssignShippingCompanyDto {
  @IsUUID()
  shippingCompanyId!: string;
}
