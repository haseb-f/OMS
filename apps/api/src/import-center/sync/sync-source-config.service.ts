import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, SyncRunStatus } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { GoogleSheetsService } from '../google-sheets.service';
import { parseGoogleSheetsUrl } from '../google-sheets.util';
import { CreateSyncSourceDto } from './dto/create-sync-source.dto';
import { UpdateSyncSourceDto } from './dto/update-sync-source.dto';

/**
 * CRUD for Data Synchronization sources (`SyncSourceConfig`) — the
 * persistent, named "Google Sheet -> OMS module" wiring a privileged user
 * sets up once (Leads/Store Orders) or once per provider tab (Cash Flow).
 * `SyncOrchestratorService` is the only thing that ever reads
 * `columnMapping`/reruns a sync — this service only manages the config row
 * itself, same "CRUD service is dumb, business service is smart" split
 * every other module in this API follows.
 */
@Injectable()
export class SyncSourceConfigService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly googleSheets: GoogleSheetsService,
  ) {}

  async findAll(sourceType?: string) {
    if (sourceType === 'SHIPPING_UPDATES') {
      return this.findShippingSyncSources();
    }
    const sources = await this.prisma.syncSourceConfig.findMany({
      where: {
        deletedAt: null,
        ...(sourceType ? { sourceType: sourceType as never } : {}),
      },
      orderBy: [{ sourceType: 'asc' }, { label: 'asc' }],
    });
    return this.attachLastSyncUser(sources);
  }

  /**
   * Shipping Sync uses the Store Orders Google Sheets source. A leftover
   * `SHIPPING_UPDATES` config is returned only when it does not share a
   * spreadsheet with a Store Orders source — never a second source the
   * administrator must configure.
   */
  private async findShippingSyncSources() {
    const [storeOrders, shipping] = await Promise.all([
      this.prisma.syncSourceConfig.findMany({
        where: { deletedAt: null, sourceType: 'STORE_ORDERS' },
        orderBy: { label: 'asc' },
      }),
      this.prisma.syncSourceConfig.findMany({
        where: { deletedAt: null, sourceType: 'SHIPPING_UPDATES' },
        orderBy: { label: 'asc' },
      }),
    ]);
    const storeKeys = new Set(
      storeOrders.map(
        (source) => `${source.spreadsheetId}:${source.worksheetGid ?? ''}`,
      ),
    );
    const orphanShipping = shipping.filter(
      (source) =>
        !storeKeys.has(`${source.spreadsheetId}:${source.worksheetGid ?? ''}`),
    );
    const reused = storeOrders.map((source) => {
      const shippingMeta = (
        (source.configMetadata ?? {}) as {
          shippingSync?: {
            lastSyncedAt?: string;
            lastSyncStatus?: string;
            lastSyncUserId?: string | null;
            lastSyncSummary?: {
              totalRows: number;
              importedCount: number;
              errorCount: number;
            };
          };
        }
      ).shippingSync;
      return {
        ...source,
        lastSyncedAt: shippingMeta?.lastSyncedAt
          ? new Date(shippingMeta.lastSyncedAt)
          : null,
        lastSyncStatus:
          (shippingMeta?.lastSyncStatus as SyncRunStatus | undefined) ??
          SyncRunStatus.NEVER_RUN,
        lastSyncUserId: shippingMeta?.lastSyncUserId ?? null,
        lastSyncSummary: shippingMeta?.lastSyncSummary ?? null,
      };
    });
    return this.attachLastSyncUser([...reused, ...orphanShipping]);
  }

  async findOne(id: string) {
    const source = await this.prisma.syncSourceConfig.findFirst({
      where: { id, deletedAt: null },
    });
    if (!source) {
      throw new NotFoundException(`Sync source ${id} not found`);
    }
    const [withUser] = await this.attachLastSyncUser([source]);
    return withUser;
  }

  /**
   * Read-only display enrichment for the Sync Card's "بواسطة" hover info —
   * `lastSyncUserId` is a bare UUID column (no Prisma relation), so this
   * batches a lookup against `User` instead of adding a schema relation for
   * a single display field. Never touches `SyncOrchestratorService`'s
   * commit path or any write — `lastSyncUserId` itself is still written
   * exactly as before.
   */
  private async attachLastSyncUser<T extends { lastSyncUserId: string | null }>(
    sources: T[],
  ): Promise<
    (T & {
      lastSyncUserName: string | null;
      lastSyncUserEmail: string | null;
    })[]
  > {
    const userIds = [
      ...new Set(
        sources
          .map((source) => source.lastSyncUserId)
          .filter((id): id is string => !!id),
      ),
    ];
    const users = userIds.length
      ? await this.prisma.user.findMany({
          where: { id: { in: userIds } },
          select: { id: true, fullName: true, email: true },
        })
      : [];
    const byId = new Map(users.map((user) => [user.id, user]));
    return sources.map((source) => {
      const user = source.lastSyncUserId
        ? byId.get(source.lastSyncUserId)
        : undefined;
      return {
        ...source,
        lastSyncUserName: user?.fullName ?? null,
        lastSyncUserEmail: user?.email ?? null,
      };
    });
  }

  async create(dto: CreateSyncSourceDto, userId?: string) {
    const { spreadsheetId, gid } = parseGoogleSheetsUrl(dto.spreadsheetUrl);
    const worksheetName = await this.googleSheets.resolveSheetTitle(
      spreadsheetId,
      gid,
    );

    const existing = await this.prisma.syncSourceConfig.findFirst({
      where: {
        sourceType: dto.sourceType,
        spreadsheetId,
        worksheetGid: gid ?? null,
        deletedAt: null,
      },
    });
    if (existing) {
      throw new BadRequestException(
        `A "${existing.label}" sync source already targets this exact worksheet — edit it instead of creating a duplicate.`,
      );
    }

    return this.prisma.syncSourceConfig.create({
      data: {
        sourceType: dto.sourceType,
        label: dto.label,
        spreadsheetId,
        worksheetGid: gid ?? null,
        worksheetName,
        configMetadata: {
          columnMapping: dto.columnMapping,
          ...(dto.configMetadata ?? {}),
        },
        createdBy: userId ?? null,
      },
    });
  }

  async update(id: string, dto: UpdateSyncSourceDto, userId?: string) {
    const source = await this.findOne(id);

    let spreadsheetId = source.spreadsheetId;
    let worksheetGid = source.worksheetGid;
    let worksheetName = source.worksheetName;
    if (dto.spreadsheetUrl) {
      const parsed = parseGoogleSheetsUrl(dto.spreadsheetUrl);
      spreadsheetId = parsed.spreadsheetId;
      worksheetGid = parsed.gid ?? null;
      worksheetName = await this.googleSheets.resolveSheetTitle(
        spreadsheetId,
        parsed.gid,
      );
    }

    const currentMetadata = (source.configMetadata ?? {}) as Record<
      string,
      unknown
    >;
    const columnMapping = dto.columnMapping ?? currentMetadata.columnMapping;

    return this.prisma.syncSourceConfig.update({
      where: { id },
      data: {
        label: dto.label ?? undefined,
        enabled: dto.enabled ?? undefined,
        spreadsheetId,
        worksheetGid,
        worksheetName,
        configMetadata: {
          ...currentMetadata,
          ...(dto.configMetadata ?? {}),
          columnMapping,
        } as Prisma.InputJsonValue,
        updatedBy: userId ?? null,
      },
    });
  }

  async archive(id: string, userId?: string) {
    await this.findOne(id);
    return this.prisma.syncSourceConfig.update({
      where: { id },
      data: { deletedAt: new Date(), updatedBy: userId ?? null },
    });
  }
}
