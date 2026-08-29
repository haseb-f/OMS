import { IsEnum } from 'class-validator';
import { PartnerRoleType } from '@prisma/client';

export class AssignRoleDto {
  @IsEnum(PartnerRoleType)
  role!: PartnerRoleType;
}
