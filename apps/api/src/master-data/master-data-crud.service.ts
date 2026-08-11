import { BadRequestException, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { MasterDataActivityLogService } from './master-data-activity-log.service';
import { MasterDataQueryDto } from './dto/master-data-query.dto';

/** The minimal shape every Prisma model delegate exposes — enough to drive generic CRUD. */
export interface MasterDataDelegate<TEntity> {
  findMany(args: Record<string, unknown>): Promise<TEntity[]>;
  findFirst(args: Record<string, unknown>): Promise<TEntity | null>;
  create(args: Record<string, unknown>): Promise<TEntity>;
  update(args: Record<string, unknown>): Promise<TEntity>;
  count(args: Record<string, unknown>): Promise<number>;
}

export interface MasterDataListResult<TEntity> {
  items: TEntity[];
  total: number;
  page: number;
  pageSize: number;
}

export interface MasterDataIdsResult {
  ids: string[];
  total: number;
}

export interface BulkActionResult {
  succeeded: string[];
  failed: { id: string; message: string }[];
}

/** "Select all matching filters" (Part 8) never enumerates more than this many IDs in one response — large enough for any real Master Data list, small enough that a UUID-only payload stays trivial. */
const SELECT_ALL_MATCHING_CAP = 10_000;

/**
 * Base class every Master Data service extends (Companies, Branches,
 * Warehouses, Taxes, Currencies, ...). Centralizes the logic that would
 * otherwise be duplicated 16 times: Search + pagination + sort, Create/
 * Update with unique-constraint mapping, Archive (soft-delete)/Restore, and
 * Activity Log writes. Subclasses only supply the Prisma delegate, the
 * entity's label/type, and which fields "Search" matches against — any
 * entity-specific behavior (e.g. Warehouse's parent hierarchy) stays in the
 * subclass's own methods, calling these where it can.
 */
export abstract class MasterDataCrudService<
  TEntity extends { id: string; deletedAt: Date | null },
> {
  protected abstract readonly entityType: string;
  protected abstract readonly entityLabel: string;
  protected abstract readonly searchFields: string[];
  protected readonly defaultSortField: string = 'name';

  constructor(
    protected readonly prisma: PrismaService,
    protected readonly activityLog: MasterDataActivityLogService,
  ) {}

  protected abstract get delegate(): MasterDataDelegate<TEntity>;

  private buildWhere(
    query: MasterDataQueryDto,
    extraWhere: Record<string, unknown>,
  ): Record<string, unknown> {
    const where: Record<string, unknown> = {
      ...extraWhere,
      deletedAt: query.includeArchived ? undefined : null,
    };
    if (query.search && this.searchFields.length) {
      where.OR = this.searchFields.map((field) => ({
        [field]: { contains: query.search, mode: 'insensitive' },
      }));
    }
    return where;
  }

  async findAll(
    query: MasterDataQueryDto,
    extraWhere: Record<string, unknown> = {},
    /** e.g. `{ include: { parentAccount: true } }` — for entities whose list view needs a related row's name, not just its id. */
    extraArgs: Record<string, unknown> = {},
  ): Promise<MasterDataListResult<TEntity>> {
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 20;
    const where = this.buildWhere(query, extraWhere);
    const orderBy = {
      [query.sortBy || this.defaultSortField]: query.sortOrder ?? 'asc',
    };

    const [items, total] = await Promise.all([
      this.delegate.findMany({
        where,
        skip: (page - 1) * pageSize,
        take: pageSize,
        orderBy,
        ...extraArgs,
      }),
      this.delegate.count({ where }),
    ]);

    return { items, total, page, pageSize };
  }

  /**
   * "Select all matching filters" (Part 8) — the same filter/search the list
   * view already applies, but returns bare IDs (never full records) so the
   * frontend can populate cross-page selection without downloading the
   * dataset. Capped at `SELECT_ALL_MATCHING_CAP`; `total` still reports the
   * real matching count so the UI can tell the user if the cap was hit.
   */
  async findAllIds(
    query: MasterDataQueryDto,
    extraWhere: Record<string, unknown> = {},
  ): Promise<MasterDataIdsResult> {
    const where = this.buildWhere(query, extraWhere);
    const [rows, total] = await Promise.all([
      this.delegate.findMany({
        where,
        select: { id: true },
        take: SELECT_ALL_MATCHING_CAP,
      }),
      this.delegate.count({ where }),
    ]);
    return { ids: rows.map((row) => row.id), total };
  }

  /**
   * Bulk Archive (Part 6) — a sequential loop over the existing single-row
   * `archive()`, same partial-failure pattern as Leads bulk-assign and
   * Fiscal Period bulk-close/open: one bad ID never aborts the rest of the
   * batch, and the caller gets back exactly which ones failed and why.
   */
  async archiveMany(ids: string[], userId?: string): Promise<BulkActionResult> {
    const succeeded: string[] = [];
    const failed: { id: string; message: string }[] = [];
    for (const id of ids) {
      try {
        await this.archive(id, userId);
        succeeded.push(id);
      } catch (error) {
        failed.push({
          id,
          message:
            error instanceof Error ? error.message : 'Failed to archive.',
        });
      }
    }
    return { succeeded, failed };
  }

  async findOne(id: string): Promise<TEntity> {
    const entity = await this.delegate.findFirst({
      where: { id, deletedAt: null },
    });
    if (!entity) {
      throw new NotFoundException(`${this.entityLabel} ${id} not found`);
    }
    return entity;
  }

  async create(dto: object, userId?: string): Promise<TEntity> {
    try {
      const entity = await this.delegate.create({
        data: { ...dto, createdBy: userId ?? null, updatedBy: userId ?? null },
      });
      await this.activityLog.log(
        this.entityType,
        entity.id,
        'CREATED',
        `${this.entityLabel} created`,
        userId,
      );
      return entity;
    } catch (error) {
      throw this.mapError(error);
    }
  }

  async update(id: string, dto: object, userId?: string): Promise<TEntity> {
    await this.findOne(id);
    try {
      const entity = await this.delegate.update({
        where: { id },
        data: { ...dto, updatedBy: userId ?? null },
      });
      await this.activityLog.log(
        this.entityType,
        id,
        'UPDATED',
        `${this.entityLabel} updated`,
        userId,
      );
      return entity;
    } catch (error) {
      throw this.mapError(error);
    }
  }

  /** Soft-delete — this codebase never hard-deletes reference data (same rule as Products/Suppliers). */
  async archive(id: string, userId?: string): Promise<TEntity> {
    await this.findOne(id);
    const entity = await this.delegate.update({
      where: { id },
      data: { deletedAt: new Date(), updatedBy: userId ?? null },
    });
    await this.activityLog.log(
      this.entityType,
      id,
      'ARCHIVED',
      `${this.entityLabel} archived`,
      userId,
    );
    return entity;
  }

  /** Counterpart of Archive — clears deletedAt so the row rejoins every default list. */
  async restore(id: string, userId?: string): Promise<TEntity> {
    const existing = await this.delegate.findFirst({ where: { id } });
    if (!existing) {
      throw new NotFoundException(`${this.entityLabel} ${id} not found`);
    }
    const entity = await this.delegate.update({
      where: { id },
      data: { deletedAt: null, updatedBy: userId ?? null },
    });
    await this.activityLog.log(
      this.entityType,
      id,
      'RESTORED',
      `${this.entityLabel} restored`,
      userId,
    );
    return entity;
  }

  activityFor(id: string) {
    return this.activityLog.findForEntity(this.entityType, id);
  }

  protected mapError(error: unknown): Error {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === 'P2002'
    ) {
      const target = Array.isArray(error.meta?.target)
        ? (error.meta.target as string[])
        : [];
      const field = target[0] ?? 'value';
      return new BadRequestException({
        code: 'DUPLICATE',
        message: `${this.entityLabel} with this ${field} already exists.`,
        fields: [{ field, constraints: ['unique'] }],
      });
    }
    return error as Error;
  }
}
