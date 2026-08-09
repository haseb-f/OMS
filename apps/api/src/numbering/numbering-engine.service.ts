import { Injectable, NotFoundException } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { renderNumberTemplate } from './template-renderer';

type QueryClient = PrismaService | Prisma.TransactionClient;

export interface GenerateNumberContext {
  branchCode?: string;
  warehouseCode?: string;
  companyCode?: string;
}

interface SeriesRow {
  id: string;
  docCode: string;
  template: string;
  nextNumber: number;
  padding: number;
  yearReset: boolean;
  monthReset: boolean;
  dayReset: boolean;
  lastResetKey: string | null;
}

/**
 * The ONE reusable Numbering Engine (TASK-025 Part 4) — every module that
 * needs a document number calls `generateNumber(documentType)` instead of
 * hand-rolling a Postgres sequence + string format (the pattern Suppliers/
 * Leads/Sales Orders/Payments/Purchase Orders/Inventory Movements used
 * before this task). Users never type a number; this is the only place one
 * is minted.
 */
@Injectable()
export class NumberingEngineService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * When called with no `tx`, mints the number in its own short
   * transaction (the pattern every non-Inventory caller uses — a business
   * document number, minted before the document's own transaction opens).
   * When called WITH a `tx`, participates in the caller's existing
   * transaction instead — InventoryMovement already generates its number
   * inside the same transaction as the movement row itself, so this
   * preserves that exact atomicity rather than changing it.
   */
  async generateNumber(
    documentType: string,
    context?: GenerateNumberContext,
    tx?: Prisma.TransactionClient,
  ): Promise<string> {
    if (tx) {
      return this.generateWithClient(tx, documentType, context);
    }
    return this.prisma.$transaction((innerTx) =>
      this.generateWithClient(innerTx, documentType, context),
    );
  }

  private async generateWithClient(
    client: QueryClient,
    documentType: string,
    context?: GenerateNumberContext,
  ): Promise<string> {
    // Row-locked read: two concurrent requests for the same series must
    // never hand out the same sequence number.
    const rows = await client.$queryRaw<SeriesRow[]>`
      SELECT
        id,
        doc_code AS "docCode",
        template,
        next_number AS "nextNumber",
        padding,
        year_reset AS "yearReset",
        month_reset AS "monthReset",
        day_reset AS "dayReset",
        last_reset_key AS "lastResetKey"
      FROM number_series
      WHERE document_type = ${documentType} AND active = true
      FOR UPDATE
    `;
    const series = rows[0];
    if (!series) {
      throw new NotFoundException(
        `No active number series configured for document type "${documentType}"`,
      );
    }

    const now = new Date();
    const resetKey = this.computeResetKey(series, now);
    const isNewPeriod = resetKey !== null && resetKey !== series.lastResetKey;
    const seq = isNewPeriod ? 1 : series.nextNumber;

    await client.numberSeries.update({
      where: { id: series.id },
      data: {
        nextNumber: seq + 1,
        lastResetKey: resetKey ?? series.lastResetKey,
      },
    });

    return renderNumberTemplate(series.template, {
      docCode: series.docCode,
      seq,
      padding: series.padding,
      date: now,
      branchCode: context?.branchCode,
      warehouseCode: context?.warehouseCode,
      companyCode: context?.companyCode,
    });
  }

  /** Read-only — what the NEXT number would look like, for the Settings preview. */
  async previewNext(documentType: string): Promise<string> {
    const series = await this.prisma.numberSeries.findUniqueOrThrow({
      where: { documentType },
    });
    return renderNumberTemplate(series.template, {
      docCode: series.docCode,
      seq: series.nextNumber,
      padding: series.padding,
      date: new Date(),
    });
  }

  private computeResetKey(
    series: Pick<SeriesRow, 'yearReset' | 'monthReset' | 'dayReset'>,
    date: Date,
  ): string | null {
    const year = String(date.getFullYear());
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    if (series.dayReset) return `${year}${month}${day}`;
    if (series.monthReset) return `${year}${month}`;
    if (series.yearReset) return year;
    return null;
  }
}
