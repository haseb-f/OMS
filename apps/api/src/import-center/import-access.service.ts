import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { PermissionsResolverService } from '../permissions/permissions-resolver.service';
import { ImportTypeRegistryService } from './import-type-registry.service';
import {
  importAudience,
  type ImportActor,
  type ImportTypeHandler,
} from './import-type.interface';

/** The company administrator catch-all: every import type, every company job. */
export const IMPORT_ADMIN_PERMISSION = 'import-center.manage';

/**
 * R15 (D15-16) — who may run which import and see which job. One-time
 * imports need the type's own permission (`requiredPermission(audience)`, e.g.
 * `store-orders.import` / `agent.orders.import`) — no administrator role — or,
 * for company users, `import-center.manage`. A job (and its uploaded file) is
 * visible only to its creator, unless a company caller holds
 * `import-center.manage`; agent jobs only to their creator inside the same
 * agent. Company users never see agent jobs and vice versa. A job outside the
 * caller's reach is a 404, never a 403 (no existence oracle).
 */
@Injectable()
export class ImportAccessService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly registry: ImportTypeRegistryService,
    private readonly permissions: PermissionsResolverService,
  ) {}

  /** The permission a one-time import of `handler` needs for this actor; null = not importable. */
  permissionFor(handler: ImportTypeHandler, actor: ImportActor): string | null {
    const audience = importAudience(actor);
    if (handler.requiredPermission) return handler.requiredPermission(audience);
    return audience === 'COMPANY' ? IMPORT_ADMIN_PERMISSION : null;
  }

  /** Company `import-center.manage` holder (never an agent user). */
  async isAdministrator(actor: ImportActor): Promise<boolean> {
    if (actor.agent) return false;
    return this.permissions.hasPermission(
      actor.userId,
      IMPORT_ADMIN_PERMISSION,
    );
  }

  /** The Import Center dashboard (`import-center.view` / `.manage`) lists every registered type. */
  async browsesAllTypes(actor: ImportActor): Promise<boolean> {
    if (actor.agent) return false;
    return (
      (await this.permissions.hasPermission(
        actor.userId,
        'import-center.view',
      )) || this.isAdministrator(actor)
    );
  }

  async canImport(
    handler: ImportTypeHandler,
    actor: ImportActor,
  ): Promise<boolean> {
    const permission = this.permissionFor(handler, actor);
    if (!permission) return false;
    if (await this.permissions.hasPermission(actor.userId, permission)) {
      return true;
    }
    return this.isAdministrator(actor);
  }

  /** Throws 403 unless the actor may import `type` (404 for an unknown type). */
  async assertCanImport(type: string, actor: ImportActor) {
    const handler = this.registry.get(type);
    if (await this.canImport(handler, actor)) return handler;
    const permission = this.permissionFor(handler, actor);
    throw new ForbiddenException({
      code: 'IMPORT_PERMISSION_REQUIRED',
      message: permission
        ? `لا تملك صلاحية استيراد هذا النوع (${permission}) — You do not have permission to import this type (missing "${permission}").`
        : 'هذا النوع لا يُستورد من هذه الواجهة — This type cannot be imported here.',
    });
  }

  /** Every registered type this actor may import, in registry order. */
  async importableTypes(actor: ImportActor): Promise<ImportTypeHandler[]> {
    const handlers = this.registry.list();
    const allowed = await Promise.all(
      handlers.map((handler) => this.canImport(handler, actor)),
    );
    return handlers.filter((_, index) => allowed[index]);
  }

  /** The jobs this actor may see (optionally one type). */
  async jobsWhere(
    actor: ImportActor,
    importType?: string,
  ): Promise<Prisma.ImportJobWhereInput> {
    const types = (await this.importableTypes(actor))
      .map((handler) => handler.type)
      .filter((type) => !importType || type === importType);
    if (actor.agent) {
      return {
        agentId: actor.agent.agentId,
        createdBy: actor.userId,
        importType: { in: types },
      };
    }
    const administrator = await this.isAdministrator(actor);
    return {
      agentId: null,
      importType: { in: types },
      ...(administrator ? {} : { createdBy: actor.userId }),
    };
  }

  /** 404 unless the job is visible to the actor; returns its type. */
  async assertJob(jobId: string, actor: ImportActor) {
    const job = await this.prisma.importJob.findFirst({
      where: { id: jobId, ...(await this.jobsWhere(actor)) },
      select: { id: true, importType: true },
    });
    if (!job) {
      throw new NotFoundException(`Import Job ${jobId} not found`);
    }
    return job;
  }
}
