import {
  BadRequestException,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { PermissionsResolverService } from '../../permissions/permissions-resolver.service';
import { SalesScopeService } from '../../sales-scope/sales-scope.service';
import type { ImportActor } from '../import-type.interface';

/** Agent users may name a colleague of the same agent only with this key (D15-16). */
export const AGENT_ASSIGN_PERMISSION = 'agent.records.assign';

export type ImportedRecordKind = 'LEAD' | 'ORDER';

function cannotAssign() {
  return new ForbiddenException({
    code: 'IMPORT_ASSIGN_NOT_ALLOWED',
    message:
      'لا يمكنك إسناد السجلات لمستخدمين آخرين — اترك عمود المالك فارغًا أو اكتب بريدك — You cannot assign records to others; leave the Owner column empty or use your own e-mail.',
  });
}

/**
 * R15 (D15-16, requirement 2.11) — the owner of an imported record: the
 * importer, unless the row's Owner column names another user AND the
 * importer may already assign (company: the sales-scope rules of manual
 * assignment — `crm.leads.manage` team / all scope for leads, team / all
 * scope for orders; agent: `agent.records.assign`, a user of the same agent
 * only). Otherwise the row is rejected — never silently reassigned.
 */
@Injectable()
export class ImportOwnerService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly salesScope: SalesScopeService,
    private readonly permissions: PermissionsResolverService,
  ) {}

  async resolve(
    ownerEmail: string | undefined,
    actor: ImportActor,
    kind: ImportedRecordKind,
  ): Promise<string> {
    const email = ownerEmail?.trim();
    if (!email) return actor.userId;
    const owner = await this.prisma.user.findFirst({
      where: {
        email: { equals: email, mode: 'insensitive' },
        deletedAt: null,
        ...(actor.agent
          ? { agentId: actor.agent.agentId, userType: 'AGENT', isActive: true }
          : { userType: 'INTERNAL' }),
      },
      select: { id: true },
    });
    if (!owner) {
      throw new BadRequestException({
        code: 'IMPORT_OWNER_NOT_FOUND',
        message: actor.agent
          ? `«${email}» ليس مستخدمًا نشطًا لدى الوكيل — "${email}" is not an active user of your agent.`
          : `لا يوجد موظف بالبريد «${email}» — No employee with the e-mail "${email}".`,
      });
    }
    if (owner.id === actor.userId) return owner.id;

    if (actor.agent) {
      if (
        !(await this.permissions.hasPermission(
          actor.userId,
          AGENT_ASSIGN_PERMISSION,
        ))
      ) {
        throw cannotAssign();
      }
      // `AgentOrdersService.createAgentOrder` re-checks the same key and the
      // colleague's affiliation before it records them as the order owner.
      return owner.id;
    }

    const scope = await this.salesScope.resolve(actor.userId);
    const allowed =
      this.salesScope.canSetOrderOwner(scope, owner.id) &&
      (kind === 'ORDER' || this.salesScope.canAssignLeads(scope));
    if (!allowed) throw cannotAssign();
    return owner.id;
  }
}
