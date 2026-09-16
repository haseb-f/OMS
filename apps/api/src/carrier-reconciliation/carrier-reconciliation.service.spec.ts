import { ConflictException, BadRequestException } from '@nestjs/common';
import { CarrierReconciliationService } from './carrier-reconciliation.service';

/**
 * ADR-0018 (Order Economics M2 gap closure) — deterministic coverage for
 * the carrier-charge matching/state-machine/idempotency rules. Mocks
 * PrismaService and MasterDataActivityLogService at the same boundary the
 * service itself calls, never a real DB (mirrors OrderEconomicsService's
 * own spec in this same milestone).
 */
describe('CarrierReconciliationService', () => {
  function makeService(overrides: {
    shipmentFindMany?: jest.Mock;
    storeOrderFindFirst?: jest.Mock;
    shippingCompanyFindFirst?: jest.Mock;
    currencyFindFirst?: jest.Mock;
    chargeFindUnique?: jest.Mock;
    chargeCreate?: jest.Mock;
    chargeFindFirst?: jest.Mock;
    chargeUpdate?: jest.Mock;
    importCreate?: jest.Mock;
    importUpdate?: jest.Mock;
  }) {
    const activityLog = {
      log: jest.fn().mockResolvedValue(undefined),
      findForEntity: jest.fn(),
    };
    const prisma = {
      shipment: {
        findMany: overrides.shipmentFindMany ?? jest.fn().mockResolvedValue([]),
        findFirst: jest
          .fn()
          .mockResolvedValue({ id: 'shipment-1', attemptNumber: 1 }),
      },
      storeOrder: {
        findFirst:
          overrides.storeOrderFindFirst ?? jest.fn().mockResolvedValue(null),
      },
      shippingCompany: {
        findFirst:
          overrides.shippingCompanyFindFirst ??
          jest.fn().mockResolvedValue(null),
      },
      currency: {
        findFirst:
          overrides.currencyFindFirst ??
          jest.fn().mockResolvedValue({ id: 'currency-1' }),
      },
      carrierCharge: {
        findUnique:
          overrides.chargeFindUnique ?? jest.fn().mockResolvedValue(null),
        create:
          overrides.chargeCreate ??
          jest
            .fn()
            .mockImplementation((args: { data: Record<string, unknown> }) => ({
              id: 'charge-1',
              ...args.data,
            })),
        findFirst:
          overrides.chargeFindFirst ?? jest.fn().mockResolvedValue(null),
        update:
          overrides.chargeUpdate ??
          jest
            .fn()
            .mockImplementation(
              (args: {
                where: { id: string };
                data: Record<string, unknown>;
              }) => ({
                id: args.where.id,
                ...args.data,
              }),
            ),
      },
      carrierChargeImport: {
        create:
          overrides.importCreate ??
          jest.fn().mockResolvedValue({ id: 'import-1' }),
        update: overrides.importUpdate ?? jest.fn().mockResolvedValue({}),
      },
    } as never;
    return {
      service: new CarrierReconciliationService(prisma, activityLog as never),
      prisma,
      activityLog,
    };
  }

  const CSV_HEADER =
    'Carrier,Carrier Reference,Tracking Number,Shipment Reference,Charge Amount,Currency,Charge Date';

  it('exact tracking-number match auto-sets MATCHED', async () => {
    const { service } = makeService({
      shipmentFindMany: jest.fn().mockResolvedValue([{ id: 'shipment-1' }]),
    });
    const csv = `${CSV_HEADER}\nAramex,REF-1,TRACK-1,,30,SAR,2026-01-01`;

    const summary = await service.importCsv(csv, 'charges.csv', 'user-1');

    expect(summary.matchedRows).toBe(1);
    expect(summary.unmatchedRows).toBe(0);
    expect(summary.reviewRows).toBe(0);
  });

  it('no candidate Shipment found stays UNMATCHED', async () => {
    const { service } = makeService({});
    const csv = `${CSV_HEADER}\nAramex,REF-1,UNKNOWN-TRACK,,30,SAR,2026-01-01`;

    const summary = await service.importCsv(csv, 'charges.csv', 'user-1');

    expect(summary.unmatchedRows).toBe(1);
    expect(summary.matchedRows).toBe(0);
  });

  it('multiple candidate Shipments (ambiguous Order Number match) returns REVIEW_REQUIRED, never auto-confirmed', async () => {
    const { service } = makeService({
      storeOrderFindFirst: jest.fn().mockResolvedValue({ id: 'order-1' }),
      // Tracking Number is blank on this row, so only the Order Number
      // (Shipment Reference) branch ever calls shipment.findMany — it
      // resolves both of this Order's Shipment Attempts, which is exactly
      // the ambiguous case.
      shipmentFindMany: jest
        .fn()
        .mockResolvedValue([{ id: 'shipment-1' }, { id: 'shipment-2' }]),
    });
    const csv = `${CSV_HEADER}\nAramex,REF-1,,ORD-100,30,SAR,2026-01-01`;

    const summary = await service.importCsv(csv, 'charges.csv', 'user-1');

    expect(summary.reviewRows).toBe(1);
    expect(summary.matchedRows).toBe(0);
    expect(summary.unmatchedRows).toBe(0);
  });

  it('importing the same charge twice is idempotent — no duplicate economic cost', async () => {
    const chargeCreate = jest
      .fn()
      .mockImplementation((args: { data: Record<string, unknown> }) => ({
        id: 'charge-1',
        ...args.data,
      }));
    let dedupeSeen: string | null = null;
    const chargeFindUnique = jest
      .fn()
      .mockImplementation(({ where }: { where: { dedupeKey: string } }) => {
        if (dedupeSeen === where.dedupeKey) return { id: 'charge-1' };
        dedupeSeen = where.dedupeKey;
        return null;
      });
    const { service } = makeService({ chargeCreate, chargeFindUnique });
    const csv = `${CSV_HEADER}\nAramex,REF-1,TRACK-1,,30,SAR,2026-01-01`;

    const first = await service.importCsv(csv, 'charges.csv', 'user-1');
    const second = await service.importCsv(csv, 'charges.csv', 'user-1');

    expect(first.duplicateRows).toBe(0);
    expect(chargeCreate).toHaveBeenCalledTimes(1);
    expect(second.duplicateRows).toBe(1);
  });

  it('rejects an invalid row (unknown currency) without throwing the whole import', async () => {
    const { service } = makeService({
      currencyFindFirst: jest.fn().mockResolvedValue(null),
    });
    const csv = `${CSV_HEADER}\nAramex,REF-1,TRACK-1,,30,XXX,2026-01-01`;

    const summary = await service.importCsv(csv, 'charges.csv', 'user-1');

    expect(summary.errorRows).toHaveLength(1);
    expect(summary.errorRows[0].message).toContain('XXX');
  });

  it('confirm() requires the charge to already be matched to a Shipment', async () => {
    const { service } = makeService({
      chargeFindFirst: jest.fn().mockResolvedValue({
        id: 'charge-1',
        shipmentId: null,
        reconciliationState: 'UNMATCHED',
        currency: { code: 'SAR' },
      }),
    });

    await expect(service.confirm('charge-1', 'user-1')).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('confirm() rejects a second CONFIRMED charge for the same Shipment until the first is unmatched', async () => {
    const { service } = makeService({
      chargeFindFirst: jest
        .fn()
        // findOne() lookup
        .mockResolvedValueOnce({
          id: 'charge-2',
          shipmentId: 'shipment-1',
          reconciliationState: 'MATCHED',
          chargeAmount: 30,
          currency: { code: 'SAR' },
        })
        // existing-CONFIRMED-for-shipment lookup
        .mockResolvedValueOnce({ id: 'charge-1' }),
    });

    await expect(service.confirm('charge-2', 'user-1')).rejects.toBeInstanceOf(
      ConflictException,
    );
  });

  it('match() manually rematches a charge to an explicit Shipment', async () => {
    const { service, prisma } = makeService({
      chargeFindFirst: jest.fn().mockResolvedValue({
        id: 'charge-1',
        shipmentId: null,
        reconciliationState: 'UNMATCHED',
      }),
    });

    const result = await service.match('charge-1', 'shipment-1', 'user-1');

    expect(result.reconciliationState).toBe('MATCHED');
    const updateMock = (
      prisma as unknown as {
        carrierCharge: {
          update: (args: {
            where: { id: string };
            data: Record<string, unknown>;
          }) => unknown;
        };
      }
    ).carrierCharge.update;
    expect(updateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'charge-1' },
        // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment -- `expect.objectContaining()` is untyped by design
        data: expect.objectContaining({
          shipmentId: 'shipment-1',
          reconciliationState: 'MATCHED',
        }),
      }),
    );
  });

  it('match() refuses to rematch an already-CONFIRMED charge', async () => {
    const { service } = makeService({
      chargeFindFirst: jest.fn().mockResolvedValue({
        id: 'charge-1',
        shipmentId: 'shipment-1',
        reconciliationState: 'CONFIRMED',
      }),
    });

    await expect(
      service.match('charge-1', 'shipment-2', 'user-1'),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('unmatch() reverses a CONFIRMED charge back to UNMATCHED (reversal path)', async () => {
    const { service, activityLog } = makeService({
      chargeFindFirst: jest.fn().mockResolvedValue({
        id: 'charge-1',
        shipmentId: 'shipment-1',
        reconciliationState: 'CONFIRMED',
      }),
    });

    const result = await service.unmatch('charge-1', 'user-1');

    expect(result.reconciliationState).toBe('UNMATCHED');
    expect(activityLog.log).toHaveBeenCalledWith(
      'CARRIER_CHARGE',
      'charge-1',
      'UNMATCHED',
      expect.any(String),
      'user-1',
    );
  });

  it('confirm() succeeds and writes an audit entry when nothing else is CONFIRMED for that Shipment', async () => {
    const { service, activityLog } = makeService({
      chargeFindFirst: jest
        .fn()
        .mockResolvedValueOnce({
          id: 'charge-1',
          shipmentId: 'shipment-1',
          reconciliationState: 'MATCHED',
          chargeAmount: 30,
          currency: { code: 'SAR' },
        })
        .mockResolvedValueOnce(null),
    });

    const result = await service.confirm('charge-1', 'user-1');

    expect(result.reconciliationState).toBe('CONFIRMED');
    expect(activityLog.log).toHaveBeenCalledWith(
      'CARRIER_CHARGE',
      'charge-1',
      'CONFIRMED',
      expect.any(String),
      'user-1',
    );
  });
});
