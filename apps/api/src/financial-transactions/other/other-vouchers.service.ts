import { BadRequestException, Injectable } from '@nestjs/common';
import { FinancialTransactionStatus, Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { NumberingEngineService } from '../../numbering/numbering-engine.service';
import type { CompanyContext } from '../../common/decorators/current-company-context.decorator';
import {
  FinancialTransactionActivityService,
  FinancialTransactionActivityType,
} from '../activities/financial-transaction-activity.service';
import {
  FinancialTransactionsService,
  TRANSACTION_INCLUDE,
  type FinancialTransactionListQuery,
} from '../financial-transactions.service';
import { listCounterAccounts } from './counter-accounts';
import { resolveOtherVoucher } from './other-voucher.rules';
import { assertVoucherDateNotInFuture } from '../shared/voucher-date';
import {
  OTHER_VOUCHER_LABEL,
  type CounterDirection,
  type OtherVoucherType,
} from './other-voucher-types';

/** Create input of the three D4 types (controllers validate the shape per type). */
export interface OtherVoucherCreateInput {
  counterAccountId?: string;
  receivingAccountId?: string;
  targetReceivingAccountId?: string;
  currencyId?: string;
  costCenterId?: string;
  projectId?: string;
  transactionDate?: string;
  paymentSourceId?: string;
  amount: number;
  referenceNumber?: string;
  description?: string;
  notes?: string;
  idempotencyKey?: string;
}

export type OtherVoucherUpdateInput = Omit<
  Partial<OtherVoucherCreateInput>,
  'idempotencyKey' | 'costCenterId' | 'projectId'
> & {
  costCenterId?: string | null;
  projectId?: string | null;
};

/**
 * R22 (decision D4) — Other Receipt / Other Payment / Internal Transfer on
 * the SAME FinancialTransaction voucher, numbering and Posting Engine as
 * receipts and payments — never a second workflow. This service owns only
 * what differs (the D4 rules on create / update / confirm, the type-scoped
 * routes); Confirm, Cancel (reversal once), Archive, Delete, lists and
 * details are `FinancialTransactionsService`'s own operations, called with
 * `types: [type]` so a voucher is only operated through its own route.
 * Drafts never post; Confirm posts one balanced entry linked by sourceType
 * (= the type) / sourceId (= the voucher), dated on the voucher date (D1).
 */
@Injectable()
export class OtherVouchersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly transactions: FinancialTransactionsService,
    private readonly numberingEngine: NumberingEngineService,
    private readonly activityService: FinancialTransactionActivityService,
  ) {}

  counterAccounts(direction: CounterDirection) {
    return listCounterAccounts(this.prisma, direction);
  }

  findAll(type: OtherVoucherType, query: FinancialTransactionListQuery) {
    return this.transactions.findAll(type, query);
  }

  findOne(type: OtherVoucherType, id: string) {
    return this.transactions.findOne(type, id);
  }

  async activities(type: OtherVoucherType, id: string) {
    await this.transactions.findOne(type, id);
    return this.transactions.activityFor(id);
  }

  async create(
    type: OtherVoucherType,
    dto: OtherVoucherCreateInput,
    userId?: string,
    context: CompanyContext = { companyId: null, branchId: null },
    outerTx?: Prisma.TransactionClient,
  ) {
    const client = outerTx ?? this.prisma;
    const replay = await this.transactions.findIdempotentReplay(
      type,
      dto,
      client,
    );
    if (replay) return replay;
    // R22 F8 — posted on the voucher date (D1): never after today.
    assertVoucherDateNotInFuture(dto.transactionDate);
    const resolved = await resolveOtherVoucher(client, type, {
      counterAccountId:
        type === 'INTERNAL_TRANSFER' ? null : (dto.counterAccountId ?? null),
      receivingAccountId: dto.receivingAccountId ?? null,
      targetReceivingAccountId:
        type === 'INTERNAL_TRANSFER'
          ? (dto.targetReceivingAccountId ?? null)
          : null,
      currencyId: dto.currencyId,
    });
    const transactionNumber = await this.numberingEngine.generateNumber(
      type,
      undefined,
      outerTx,
    );
    const label = OTHER_VOUCHER_LABEL[type];
    try {
      const work = async (tx: Prisma.TransactionClient) => {
        const transaction = await tx.financialTransaction.create({
          data: {
            transactionNumber,
            type,
            counterAccountId:
              type === 'INTERNAL_TRANSFER' ? undefined : dto.counterAccountId,
            targetReceivingAccountId:
              type === 'INTERNAL_TRANSFER'
                ? dto.targetReceivingAccountId
                : undefined,
            receivingAccountId: dto.receivingAccountId,
            currencyId: resolved.currencyId,
            companyId: context.companyId ?? undefined,
            branchId: context.branchId ?? undefined,
            costCenterId: dto.costCenterId,
            projectId: dto.projectId,
            transactionDate: dto.transactionDate
              ? new Date(dto.transactionDate)
              : undefined,
            paymentSourceId: dto.paymentSourceId,
            amount: dto.amount,
            referenceNumber: dto.referenceNumber,
            description: dto.description,
            notes: dto.notes,
            createdBy: userId ?? null,
            updatedBy: userId ?? null,
            idempotencyKey: dto.idempotencyKey || undefined,
          },
          include: TRANSACTION_INCLUDE,
        });
        await this.activityService.log(
          transaction.id,
          FinancialTransactionActivityType.TRANSACTION_CREATED,
          `${label} ${transaction.transactionNumber} created`,
          undefined,
          tx,
        );
        return transaction;
      };
      return await (outerTx ? work(outerTx) : this.prisma.$transaction(work));
    } catch (error) {
      if (!outerTx && this.transactions.isIdempotencyKeyClash(error)) {
        const winner = await this.transactions.findIdempotentReplay(type, dto);
        if (winner) return winner;
      }
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2003'
      ) {
        throw new BadRequestException(
          'Invalid account, currency, payment source, cost centre or project reference.',
        );
      }
      throw error;
    }
  }

  /** Create + Confirm + Post atomically; a repeated key returns the first (confirmed) voucher. */
  async createConfirmed(
    type: OtherVoucherType,
    dto: OtherVoucherCreateInput,
    userId?: string,
    context: CompanyContext = { companyId: null, branchId: null },
  ) {
    const replay = await this.transactions.findIdempotentReplay(
      type,
      dto,
      this.prisma,
      { requireConfirmed: true },
    );
    if (replay) return replay;
    try {
      return await this.prisma.$transaction(
        async (tx) => {
          const created = await this.create(type, dto, userId, context, tx);
          return this.transactions.confirm(created.id, userId, tx, {
            types: [type],
          });
        },
        { maxWait: 10_000, timeout: 30_000 },
      );
    } catch (error) {
      if (this.transactions.isIdempotencyKeyClash(error)) {
        const winner = await this.transactions.findIdempotentReplay(
          type,
          dto,
          this.prisma,
          { requireConfirmed: true },
        );
        if (winner) return winner;
      }
      throw error;
    }
  }

  async update(
    type: OtherVoucherType,
    id: string,
    dto: OtherVoucherUpdateInput,
    userId?: string,
  ) {
    const existing = await this.transactions.findOne(type, id);
    this.assertDraft(type, existing);
    assertVoucherDateNotInFuture(dto.transactionDate);
    const accountsChanged =
      dto.receivingAccountId !== undefined ||
      dto.targetReceivingAccountId !== undefined;
    const resolved = await resolveOtherVoucher(this.prisma, type, {
      counterAccountId:
        type === 'INTERNAL_TRANSFER'
          ? null
          : (dto.counterAccountId ?? existing.counterAccountId),
      receivingAccountId: dto.receivingAccountId ?? existing.receivingAccountId,
      targetReceivingAccountId:
        type === 'INTERNAL_TRANSFER'
          ? (dto.targetReceivingAccountId ?? existing.targetReceivingAccountId)
          : null,
      // A new cash / bank account brings its own currency unless one is chosen.
      currencyId:
        dto.currencyId !== undefined
          ? dto.currencyId
          : accountsChanged
            ? undefined
            : existing.currencyId,
    });
    const label = OTHER_VOUCHER_LABEL[type];
    return this.prisma.$transaction(async (tx) => {
      // Serialize with a concurrent Confirm: only a Draft is ever edited.
      await tx.$queryRaw`
        SELECT id FROM financial_transactions WHERE id = ${id}::uuid FOR UPDATE
      `;
      const current = await tx.financialTransaction.findUniqueOrThrow({
        where: { id },
        select: { status: true, transactionNumber: true },
      });
      this.assertDraft(type, current);
      const transaction = await tx.financialTransaction.update({
        where: { id },
        data: {
          counterAccountId:
            type === 'INTERNAL_TRANSFER' ? undefined : dto.counterAccountId,
          targetReceivingAccountId:
            type === 'INTERNAL_TRANSFER'
              ? dto.targetReceivingAccountId
              : undefined,
          receivingAccountId: dto.receivingAccountId,
          currencyId: resolved.currencyId,
          costCenterId: dto.costCenterId,
          projectId: dto.projectId,
          transactionDate: dto.transactionDate
            ? new Date(dto.transactionDate)
            : undefined,
          paymentSourceId: dto.paymentSourceId,
          amount: dto.amount,
          referenceNumber: dto.referenceNumber,
          description: dto.description,
          notes: dto.notes,
          updatedBy: userId ?? null,
        },
        include: TRANSACTION_INCLUDE,
      });
      await this.activityService.log(
        id,
        FinancialTransactionActivityType.TRANSACTION_UPDATED,
        `${label} ${transaction.transactionNumber} updated`,
        undefined,
        tx,
      );
      return transaction;
    });
  }

  /** Re-checks the D4 rules for a clean error, then the shared Confirm posts (rules re-enforced by the provider). */
  async confirm(type: OtherVoucherType, id: string, userId?: string) {
    const existing = await this.transactions.findOne(type, id);
    if (existing.status === FinancialTransactionStatus.DRAFT) {
      await resolveOtherVoucher(this.prisma, type, existing, {
        forPosting: true,
      });
    }
    return this.transactions.confirm(id, userId, undefined, { types: [type] });
  }

  async cancel(type: OtherVoucherType, id: string, userId?: string) {
    await this.transactions.findOne(type, id);
    return this.transactions.cancel(id, userId, { types: [type] });
  }

  async archive(type: OtherVoucherType, id: string, userId?: string) {
    await this.transactions.findOne(type, id);
    return this.transactions.archive(id, userId, { types: [type] });
  }

  async remove(type: OtherVoucherType, id: string) {
    await this.transactions.findOne(type, id);
    return this.transactions.remove(id, { types: [type] });
  }

  private assertDraft(
    type: OtherVoucherType,
    voucher: { status: FinancialTransactionStatus; transactionNumber: string },
  ) {
    if (voucher.status !== FinancialTransactionStatus.DRAFT) {
      throw new BadRequestException(
        `Only a Draft ${OTHER_VOUCHER_LABEL[type].toLowerCase()} can be edited — ${voucher.transactionNumber} is ${voucher.status}.`,
      );
    }
  }
}
