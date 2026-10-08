import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, type ImportSheetConnection } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { GoogleSheetsService } from '../google-sheets.service';
import type { ImportActor } from '../import-type.interface';

const CONNECTION_SELECT = {
  id: true,
  spreadsheetId: true,
  title: true,
  lastUsedAt: true,
  createdAt: true,
} satisfies Prisma.ImportSheetConnectionSelect;

/**
 * R15 (D15-17) — private Google Sheets connected for one-time imports. The
 * owner shares the sheet with the OMS service account (Viewer) — never
 * public. The first company user / agent that connects a spreadsheet owns it;
 * nobody else can import from it, and a spreadsheet that a continuous sync
 * source (`SyncSourceConfig`) reads can never be one-time imported: one
 * ingestion path per sheet.
 */
@Injectable()
export class ImportSheetConnectionsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly googleSheets: GoogleSheetsService,
  ) {}

  /** The address the user shares the sheet with — shown on the connect step. */
  serviceAccount() {
    return { email: this.googleSheets.serviceAccountEmail() };
  }

  list(actor: ImportActor) {
    return this.prisma.importSheetConnection.findMany({
      where: { ...this.ownerWhere(actor), revokedAt: null },
      select: CONNECTION_SELECT,
      orderBy: { createdAt: 'desc' },
    });
  }

  /**
   * Connects (or re-uses) the spreadsheet for this actor: refused when a sync
   * source reads it or another owner holds it; access is verified with the
   * service account (a clear 403 message naming the address to share with).
   */
  async connect(spreadsheetId: string, actor: ImportActor) {
    await this.assertNotSynchronised(spreadsheetId);
    const existing = await this.prisma.importSheetConnection.findUnique({
      where: { spreadsheetId },
    });
    if (existing && !existing.revokedAt && !this.ownedBy(existing, actor)) {
      throw connectedByAnotherUser();
    }
    const metadata =
      await this.googleSheets.getSpreadsheetMetadata(spreadsheetId);
    const owner = actor.agent
      ? { ownerUserId: null, agentId: actor.agent.agentId }
      : { ownerUserId: actor.userId, agentId: null };
    if (existing) {
      // A revoked connection is free again: the new connector becomes its owner.
      const claimed = await this.prisma.importSheetConnection.updateMany({
        where: {
          id: existing.id,
          ...(existing.revokedAt ? { revokedAt: { not: null } } : owner),
        },
        data: {
          ...owner,
          title: metadata.title,
          revokedAt: null,
          lastUsedAt: new Date(),
        },
      });
      if (claimed.count === 0) throw connectedByAnotherUser();
      return this.prisma.importSheetConnection.findUniqueOrThrow({
        where: { id: existing.id },
        select: CONNECTION_SELECT,
      });
    }
    try {
      return await this.prisma.importSheetConnection.create({
        data: {
          spreadsheetId,
          title: metadata.title,
          ...owner,
          lastUsedAt: new Date(),
          createdBy: actor.userId,
        },
        select: CONNECTION_SELECT,
      });
    } catch (error) {
      // Two users connected the same sheet at the same moment: the first wins.
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        throw connectedByAnotherUser();
      }
      throw error;
    }
  }

  /** Refresh / re-read: the actor's live connection, and still not a sync sheet. */
  async assertUsable(spreadsheetId: string, actor: ImportActor) {
    await this.assertNotSynchronised(spreadsheetId);
    const connection = await this.prisma.importSheetConnection.findUnique({
      where: { spreadsheetId },
    });
    if (
      !connection ||
      connection.revokedAt ||
      !this.ownedBy(connection, actor)
    ) {
      throw connectedByAnotherUser();
    }
    await this.prisma.importSheetConnection.update({
      where: { id: connection.id },
      data: { lastUsedAt: new Date() },
    });
  }

  /** Disconnects one of the actor's sheets (the spreadsheet itself is untouched). */
  async revoke(id: string, actor: ImportActor) {
    const revoked = await this.prisma.importSheetConnection.updateMany({
      where: { id, revokedAt: null, ...this.ownerWhere(actor) },
      data: { revokedAt: new Date() },
    });
    if (revoked.count === 0) {
      throw new NotFoundException(`Sheet connection ${id} not found`);
    }
    return { id, revoked: true };
  }

  private async assertNotSynchronised(spreadsheetId: string) {
    const source = await this.prisma.syncSourceConfig.findFirst({
      where: { spreadsheetId, deletedAt: null },
      select: { label: true },
    });
    if (source) {
      throw new BadRequestException({
        code: 'SHEET_SYNCHRONISED',
        message: `هذا الجدول يُزامَن باستمرار عبر «${source.label}» — صفوفه تصل عبر المزامنة — This sheet is synchronised continuously by "${source.label}"; its rows arrive through the sync.`,
      });
    }
  }

  private ownerWhere(
    actor: ImportActor,
  ): Prisma.ImportSheetConnectionWhereInput {
    return actor.agent
      ? { agentId: actor.agent.agentId }
      : { agentId: null, ownerUserId: actor.userId };
  }

  private ownedBy(connection: ImportSheetConnection, actor: ImportActor) {
    return actor.agent
      ? connection.agentId === actor.agent.agentId
      : connection.agentId === null && connection.ownerUserId === actor.userId;
  }
}

function connectedByAnotherUser() {
  return new ConflictException({
    code: 'SHEET_CONNECTED_BY_ANOTHER_USER',
    message:
      'هذا الجدول مربوط بواسطة مستخدم آخر — This sheet is connected by another user.',
  });
}
