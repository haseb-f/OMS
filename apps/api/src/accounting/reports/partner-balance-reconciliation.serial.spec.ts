import { JournalEntryStatus, PartnerControlAccountType } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { PartnersService } from '../../partners/partners.service';
import { AccountingReportsService } from './accounting-reports.service';
import { partnerLedgerBalances } from './partner-ledger-balance';

const cents = (value: number) => Math.round(value * 100) || 0;

/**
 * Read-only reconciliation against the local development database: the
 * balance a Customer/Supplier record displays (`receivableBalance` /
 * `payableBalance`) must equal the closing balance of that partner's
 * Receivable/Payable statement, and the sum over partners must equal the
 * partner-tagged balance of the AR/AP control accounts. Covers every case a
 * document-derived figure used to miss: unallocated advances, refunds,
 * foreign-currency documents, bank fees, opening balances. Never writes.
 * Skipped unless DATABASE_URL points at a local DB.
 */
const LOCAL_DB = /@(localhost|127\.0\.0\.1)[:/]/.test(
  process.env.DATABASE_URL ?? '',
);
const describeDb = LOCAL_DB ? describe : describe.skip;

describeDb(
  'Partner balances reconcile with statements and GL (local DB)',
  () => {
    jest.setTimeout(120_000);
    let prisma: PrismaService;
    let reports: AccountingReportsService;
    let partners: PartnersService;

    beforeAll(async () => {
      prisma = new PrismaService();
      await prisma.$connect();
      reports = new AccountingReportsService(prisma);
      partners = new PartnersService(
        prisma,
        {} as never,
        {} as never,
        {} as never,
      );
    });

    afterAll(async () => {
      await prisma?.$disconnect();
    });

    async function partnersWithControlLines(
      controlType: PartnerControlAccountType,
    ) {
      const groups = await prisma.journalEntryLine.groupBy({
        by: ['partnerId'],
        where: {
          partnerId: { not: null },
          account: { partnerControlType: controlType },
          journalEntry: {
            deletedAt: null,
            status: {
              in: [JournalEntryStatus.POSTED, JournalEntryStatus.REVERSED],
            },
          },
        },
        _sum: { debit: true, credit: true },
      });
      return groups.map((g) => g.partnerId!);
    }

    it('every partner balance equals its statement closing balance', async () => {
      for (const controlType of [
        PartnerControlAccountType.RECEIVABLE,
        PartnerControlAccountType.PAYABLE,
      ]) {
        const ids = await partnersWithControlLines(controlType);
        const balances = await partnerLedgerBalances(prisma, ids);
        for (const partnerId of ids) {
          const statement = await reports.partnerStatement({
            partnerId,
            controlType,
            postedOnly: true,
          });
          const balance = balances.get(partnerId)!;
          // Statements are debit-positive; payable is shown credit-positive.
          const expected =
            controlType === PartnerControlAccountType.RECEIVABLE
              ? statement.closingBalance
              : -statement.closingBalance;
          const shown =
            controlType === PartnerControlAccountType.RECEIVABLE
              ? balance.receivable
              : balance.payable;
          expect({ partnerId, balance: cents(shown) }).toEqual({
            partnerId,
            balance: cents(expected),
          });
        }
      }
    });

    it('the balance the partner record exposes is the ledger balance', async () => {
      const ids = [
        ...(await partnersWithControlLines(
          PartnerControlAccountType.RECEIVABLE,
        )),
        ...(await partnersWithControlLines(PartnerControlAccountType.PAYABLE)),
      ].slice(0, 25);
      const live = await prisma.partner.findMany({
        where: { id: { in: ids }, deletedAt: null },
        select: { id: true },
      });
      const balances = await partnerLedgerBalances(
        prisma,
        live.map((p) => p.id),
      );
      for (const { id } of live) {
        const record = await partners.findOne(id);
        expect(cents(record.receivableBalance)).toBe(
          cents(balances.get(id)?.receivable ?? 0),
        );
        expect(cents(record.payableBalance)).toBe(
          cents(balances.get(id)?.payable ?? 0),
        );
      }
    });

    it('sum of partner balances = partner-tagged AR/AP control accounts in the GL', async () => {
      for (const controlType of [
        PartnerControlAccountType.RECEIVABLE,
        PartnerControlAccountType.PAYABLE,
      ]) {
        const ids = await partnersWithControlLines(controlType);
        const balances = await partnerLedgerBalances(prisma, ids);
        const partnerTotal = [...balances.values()].reduce(
          (s, b) =>
            s +
            (controlType === PartnerControlAccountType.RECEIVABLE
              ? b.receivable
              : -b.payable),
          0,
        );
        const controlAccounts = await prisma.chartOfAccount.findMany({
          where: { partnerControlType: controlType, deletedAt: null },
          select: { id: true },
        });
        if (controlAccounts.length === 0) continue;
        const gl = await reports.generalLedger({
          accountIds: controlAccounts.map((a) => a.id),
          postedOnly: true,
          page: 1,
          pageSize: 200,
        });
        const partnerTaggedGl = gl.items
          .flatMap((l) => l.movements)
          .filter((m) => m.partner)
          .reduce((s, m) => s + m.debit - m.credit, 0);
        expect(cents(partnerTotal)).toBe(cents(partnerTaggedGl));
      }
    });

    it('customer refunds appear on the statement as debit lines', async () => {
      const refundLines = await prisma.journalEntryLine.findMany({
        where: {
          partnerId: { not: null },
          account: {
            partnerControlType: PartnerControlAccountType.RECEIVABLE,
          },
          journalEntry: {
            sourceType: 'CUSTOMER_REFUND',
            reversalOfEntryId: null,
            deletedAt: null,
          },
        },
        select: { id: true, partnerId: true, debit: true },
        take: 5,
      });
      for (const line of refundLines) {
        const statement = await reports.partnerStatement({
          partnerId: line.partnerId!,
          controlType: PartnerControlAccountType.RECEIVABLE,
          postedOnly: true,
        });
        const movement = statement.movements.find((m) => m.lineId === line.id);
        expect(movement).toBeDefined();
        expect(movement!.sourceType).toBe('CUSTOMER_REFUND');
        expect(movement!.debit).toBeGreaterThan(0);
        expect(cents(movement!.debit)).toBe(cents(Number(line.debit)));
      }
    });
  },
);
