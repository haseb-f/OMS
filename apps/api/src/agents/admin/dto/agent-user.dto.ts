import { Transform } from 'class-transformer';
import {
  ArrayUnique,
  IsArray,
  IsEmail,
  IsIn,
  IsNotEmpty,
  IsOptional,
  IsString,
} from 'class-validator';
import {
  toNormalizedEmail,
  toNormalizedUsername,
} from '../../../auth/password.util';
import {
  AGENT_PORTAL_PERMISSIONS,
  type AgentPortalPermission,
} from '../../../permissions/permission-catalog';

/** Agent user (spec §3) — affiliation comes from the route/actor, never the body. */
export class CreateAgentUserDto {
  @Transform(({ value }: { value: unknown }) => toNormalizedEmail(value))
  @IsEmail()
  email!: string;

  @Transform(({ value }: { value: unknown }) => toNormalizedUsername(value))
  @IsString()
  @IsNotEmpty()
  username!: string;

  @IsString()
  @IsNotEmpty()
  fullName!: string;

  @IsString()
  @IsOptional()
  mobile?: string;

  @IsIn(['ADMIN', 'SALES'])
  agentRole!: 'ADMIN' | 'SALES';

  /** Extra `agent.*` permissions on top of the role preset (explicit delegation). */
  @IsArray()
  @ArrayUnique()
  @IsIn(AGENT_PORTAL_PERMISSIONS, { each: true })
  @IsOptional()
  extraPermissions?: AgentPortalPermission[];
}

export class SetAgentUserPermissionsDto {
  @IsArray()
  @ArrayUnique()
  @IsIn(AGENT_PORTAL_PERMISSIONS, { each: true })
  permissionNames!: AgentPortalPermission[];
}

/** Agent Admin delegation (portal): SALES users only. */
export class CreateAgentSalesUserDto {
  @Transform(({ value }: { value: unknown }) => toNormalizedEmail(value))
  @IsEmail()
  email!: string;

  @Transform(({ value }: { value: unknown }) => toNormalizedUsername(value))
  @IsString()
  @IsNotEmpty()
  username!: string;

  @IsString()
  @IsNotEmpty()
  fullName!: string;

  @IsString()
  @IsOptional()
  mobile?: string;

  /** Must be a subset of the Agent Admin's own permissions, never `agent.team.manage`. */
  @IsArray()
  @ArrayUnique()
  @IsIn(AGENT_PORTAL_PERMISSIONS, { each: true })
  @IsOptional()
  permissionNames?: AgentPortalPermission[];
}
