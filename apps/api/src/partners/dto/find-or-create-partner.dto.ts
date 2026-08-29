import { IsEnum } from 'class-validator';
import { OmitType } from '@nestjs/mapped-types';
import { PartnerRoleType } from '@prisma/client';
import { CreatePartnerDto } from './create-partner.dto';

/**
 * Powers every Quick Create picker (Sales Invoice's "+ إضافة عميل جديد",
 * Purchase Invoice's "+ إضافة مورد جديد", ...) — spec section 39: creates a
 * Partner + assigns `role`, or reuses an existing Partner by phone/mobile/
 * email/tax number and adds `role` to it if not already held. Never creates
 * a duplicate identity. `roles` from CreatePartnerDto is replaced by the
 * single `role` this endpoint is scoped to.
 */
export class FindOrCreatePartnerDto extends OmitType(CreatePartnerDto, [
  'roles',
] as const) {
  @IsEnum(PartnerRoleType)
  role!: PartnerRoleType;
}
