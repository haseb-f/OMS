import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
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
    return this.prisma.syncSourceConfig.findMany({
      where: {
        deletedAt: null,
        ...(sourceType ? { sourceType: sourceType as never } : {}),
      },
      orderBy: [{ sourceType: 'asc' }, { label: 'asc' }],
    });
  }

  async findOne(id: string) {
    const source = await this.prisma.syncSourceConfig.findFirst({
      where: { id, deletedAt: null },
    });
    if (!source) {
      throw new NotFoundException(`Sync source ${id} not found`);
    }
    return source;
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
