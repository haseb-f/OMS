import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { MasterDataActivityLogService } from '../../master-data/master-data-activity-log.service';
import { UsersService } from '../../users/users.service';
import { ResetPasswordDto } from '../../users/dto/reset-password.dto';
import { PermissionsResolverService } from '../../permissions/permissions-resolver.service';
import {
  AGENT_ROLE_PRESETS,
  isAgentPortalPermission,
  type AgentPortalPermission,
} from '../../permissions/permission-catalog';
import type { AgentRequestContext } from '../../auth/guards/jwt-auth.guard';
import {
  agentBadRequest,
  agentForbidden,
  agentNotFoundError,
  agentUnprocessable,
} from '../common/agent-errors';
import type {
  CreateAgentSalesUserDto,
  CreateAgentUserDto,
} from './dto/agent-user.dto';

const AGENT_USER_SELECT = {
  id: true,
  email: true,
  username: true,
  fullName: true,
  mobile: true,
  isActive: true,
  isLocked: true,
  mustChangePassword: true,
  lastLoginAt: true,
  createdAt: true,
  userType: true,
  agentId: true,
  agentRole: true,
  userPermissions: { select: { permission: { select: { name: true } } } },
} as const;

type AgentUserRow = {
  userPermissions: { permission: { name: string } }[];
} & Record<string, unknown>;

function mapUser<T extends AgentUserRow>(row: T) {
  const { userPermissions, ...rest } = row;
  return {
    ...rest,
    permissions: userPermissions
      .map((p) => p.permission.name)
      .filter(isAgentPortalPermission)
      .sort(),
  };
}

const AGENT_USER_ENTITY = 'AGENT_USER';

/**
 * `agent.team.manage` is an Agent Admin capability only (S7): a SALES user
 * never holds it, whoever grants it (internal extra permissions included).
 */
function assertRoleAllows(role: string | null, permissionNames: string[]) {
  if (role !== 'ADMIN' && permissionNames.includes('agent.team.manage')) {
    throw agentBadRequest(
      'AGENT_TEAM_MANAGE_ADMIN_ONLY',
      'صلاحية إدارة الفريق لمدير الوكيل فقط',
      'agent.team.manage can only be held by an Agent Admin.',
      { permissions: ['agent.team.manage'] },
    );
  }
}

/**
 * Internal administration of an agent's users (spec §3, `agents.users.*`).
 * Creation goes through `UsersService.createAgentUser` — the only path that
 * sets agent affiliation — and permissions through `UsersService.setPermissions`
 * (which rejects any non-`agent.*` grant for agent users).
 */
@Injectable()
export class AgentUsersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly users: UsersService,
    private readonly activityLog: MasterDataActivityLogService,
  ) {}

  async list(agentId: string) {
    await this.requireAgent(agentId);
    const rows = await this.prisma.user.findMany({
      where: { agentId, userType: 'AGENT', deletedAt: null },
      select: AGENT_USER_SELECT,
      orderBy: [{ agentRole: 'asc' }, { fullName: 'asc' }],
    });
    return rows.map(mapUser);
  }

  async create(agentId: string, dto: CreateAgentUserDto, actorId: string) {
    await this.requireActiveAgent(agentId);
    const permissionNames = [
      ...new Set([
        ...AGENT_ROLE_PRESETS[dto.agentRole],
        ...(dto.extraPermissions ?? []),
      ]),
    ];
    assertRoleAllows(dto.agentRole, permissionNames);
    return this.users.createAgentUser({
      agentId,
      agentRole: dto.agentRole,
      email: dto.email,
      username: dto.username,
      fullName: dto.fullName,
      mobile: dto.mobile,
      permissionNames,
      createdBy: actorId,
    });
  }

  async setPermissions(
    agentId: string,
    userId: string,
    permissionNames: AgentPortalPermission[],
  ) {
    const user = await this.requireAgentUser(agentId, userId);
    assertRoleAllows(user.agentRole, permissionNames);
    await this.users.setPermissions(userId, { permissionNames });
    return this.findOne(agentId, userId);
  }

  /**
   * Activate / deactivate, audited with who did it (S7). An Agent Admin can
   * never re-enable a user the company deactivated: the latest activation
   * change is read from the activity log.
   */
  async setActive(
    agentId: string,
    userId: string,
    isActive: boolean,
    actor: { userId: string; kind: 'INTERNAL' | 'AGENT_ADMIN' },
  ) {
    await this.requireAgentUser(agentId, userId);
    if (isActive && actor.kind === 'AGENT_ADMIN') {
      const lastChange = await this.prisma.masterDataActivityLog.findFirst({
        where: {
          entityType: AGENT_USER_ENTITY,
          entityId: userId,
          type: { in: ['DEACTIVATED', 'ACTIVATED'] },
        },
        orderBy: { createdAt: 'desc' },
        select: { type: true, metadata: true },
      });
      const by = (lastChange?.metadata as { by?: string } | null)?.by;
      if (lastChange?.type === 'DEACTIVATED' && by === 'INTERNAL') {
        throw agentForbidden(
          'AGENT_USER_DEACTIVATED_BY_COMPANY',
          'أوقفت الشركة هذا المستخدم — لا يعاد تفعيله إلا من الشركة',
          'This user was deactivated by the company and can only be re-activated by the company.',
        );
      }
    }
    await this.users.update(userId, { isActive });
    await this.activityLog.log(
      AGENT_USER_ENTITY,
      userId,
      isActive ? 'ACTIVATED' : 'DEACTIVATED',
      `Agent user ${isActive ? 'activated' : 'deactivated'} by ${actor.kind === 'INTERNAL' ? 'company staff' : 'agent admin'}`,
      actor.userId,
      { by: actor.kind, agentId },
    );
    return this.findOne(agentId, userId);
  }

  /** Admin-entered / form-generated password, or empty → server-generated (R13 A2). */
  async resetPassword(
    agentId: string,
    userId: string,
    dto: ResetPasswordDto = {},
  ) {
    await this.requireAgentUser(agentId, userId);
    return this.users.resetPassword(userId, dto);
  }

  async findOne(agentId: string, userId: string) {
    const row = await this.prisma.user.findFirst({
      where: { id: userId, agentId, userType: 'AGENT', deletedAt: null },
      select: AGENT_USER_SELECT,
    });
    if (!row) throw agentNotFoundError('Agent user', 'مستخدم الوكيل');
    return mapUser(row);
  }

  async requireAgentUser(agentId: string, userId: string) {
    const user = await this.prisma.user.findFirst({
      where: { id: userId, agentId, userType: 'AGENT', deletedAt: null },
      select: { id: true, agentRole: true },
    });
    if (!user) throw agentNotFoundError('Agent user', 'مستخدم الوكيل');
    return user;
  }

  private async requireAgent(agentId: string) {
    const agent = await this.prisma.agent.findFirst({
      where: { id: agentId, deletedAt: null },
      select: { id: true, status: true },
    });
    if (!agent) throw agentNotFoundError('Agent', 'الوكيل');
    return agent;
  }

  private async requireActiveAgent(agentId: string) {
    const agent = await this.requireAgent(agentId);
    if (agent.status !== 'ACTIVE') {
      throw agentUnprocessable(
        'AGENT_NOT_ACTIVE',
        'الوكيل غير نشط',
        'The agent is not active.',
      );
    }
  }
}

/**
 * Agent Admin delegation (spec §3) for the agent portal (B3). The caller's
 * agent comes only from the server-verified `AgentRequestContext`. An Agent
 * Admin holding `agent.team.manage` may create / deactivate / re-permission
 * SALES users of their own agent, granting only permissions they hold
 * themselves and never `agent.team.manage`; ADMIN users, other agents and
 * their own account are out of reach.
 */
@Injectable()
export class AgentTeamService {
  constructor(
    private readonly agentUsers: AgentUsersService,
    private readonly users: UsersService,
    private readonly resolver: PermissionsResolverService,
  ) {}

  /** `agent.team.view` or `agent.team.manage` is checked by the portal guard. */
  list(actor: AgentRequestContext) {
    return this.agentUsers.list(actor.agentId);
  }

  async createSalesUser(
    actor: AgentRequestContext,
    dto: CreateAgentSalesUserDto,
  ) {
    const own = await this.assertTeamManager(actor);
    const requested = dto.permissionNames ?? [
      ...AGENT_ROLE_PRESETS.SALES.filter((name) => own.has(name)),
    ];
    this.assertDelegable(own, requested);
    return this.users.createAgentUser({
      agentId: actor.agentId,
      agentRole: 'SALES',
      email: dto.email,
      username: dto.username,
      fullName: dto.fullName,
      mobile: dto.mobile,
      permissionNames: requested,
      createdBy: actor.userId,
    });
  }

  async setSalesUserActive(
    actor: AgentRequestContext,
    userId: string,
    isActive: boolean,
  ) {
    await this.assertTeamManager(actor);
    await this.requireManagedSalesUser(actor, userId);
    return this.agentUsers.setActive(actor.agentId, userId, isActive, {
      userId: actor.userId,
      kind: 'AGENT_ADMIN',
    });
  }

  async setSalesUserPermissions(
    actor: AgentRequestContext,
    userId: string,
    permissionNames: AgentPortalPermission[],
  ) {
    const own = await this.assertTeamManager(actor);
    await this.requireManagedSalesUser(actor, userId);
    this.assertDelegable(own, permissionNames);
    return this.agentUsers.setPermissions(
      actor.agentId,
      userId,
      permissionNames,
    );
  }

  async resetSalesUserPassword(
    actor: AgentRequestContext,
    userId: string,
    dto: ResetPasswordDto = {},
  ) {
    await this.assertTeamManager(actor);
    await this.requireManagedSalesUser(actor, userId);
    return this.agentUsers.resetPassword(actor.agentId, userId, dto);
  }

  private async assertTeamManager(
    actor: AgentRequestContext,
  ): Promise<Set<string>> {
    const own = await this.resolver.getPermissions(actor.userId);
    // Server-verified role, not only the grant (S7): a SALES user never
    // manages the team, whatever permission rows exist.
    if (actor.agentRole !== 'ADMIN' || !own.has('agent.team.manage')) {
      throw agentForbidden(
        'AGENT_PERMISSION_REQUIRED',
        'إدارة الفريق تتطلب صلاحية agent.team.manage',
        'Managing the team requires the agent.team.manage permission.',
      );
    }
    return own;
  }

  private async requireManagedSalesUser(
    actor: AgentRequestContext,
    userId: string,
  ) {
    if (userId === actor.userId) {
      throw agentForbidden(
        'AGENT_TEAM_SELF',
        'لا يمكنك تعديل حسابك أو صلاحياتك بنفسك',
        'You cannot change your own account or permissions.',
      );
    }
    const target = await this.agentUsers.requireAgentUser(
      actor.agentId,
      userId,
    );
    if (target.agentRole !== 'SALES') {
      throw agentForbidden(
        'AGENT_TEAM_ADMIN_TARGET',
        'مدير الوكيل يدير مستخدمي المبيعات فقط',
        'An Agent Admin can manage Sales users only.',
      );
    }
  }

  private assertDelegable(own: Set<string>, requested: string[]) {
    const notAgent = requested.filter((name) => !isAgentPortalPermission(name));
    if (notAgent.length > 0) {
      throw agentBadRequest(
        'AGENT_USER_INTERNAL_PERMISSION',
        'مستخدمو الوكلاء يحملون صلاحيات بوابة الوكلاء فقط',
        'Agent users can only hold agent portal permissions.',
        { permissions: notAgent },
      );
    }
    const forbidden = requested.filter(
      (name) => name === 'agent.team.manage' || !own.has(name),
    );
    if (forbidden.length > 0) {
      throw agentForbidden(
        'AGENT_DELEGATION_EXCEEDED',
        'لا يمكنك منح صلاحيات لا تملكها أو صلاحية إدارة الفريق',
        'You can only grant permissions you hold yourself, and never agent.team.manage.',
        { permissions: forbidden },
      );
    }
  }
}
