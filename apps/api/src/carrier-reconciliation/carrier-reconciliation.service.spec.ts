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
    chargeFindMany?: jest.Mock;
    chargeUpdate?: jest.Mock;
    importCreate?: jest.Mock;
    importUpdate?: jest.Mock;
  }) {
    const activityLog = {
      log: jest.fn().mockResolvedValue(undefined),
      findForEntity: jest.fn(),
    };
    const prisma: Record<string, unknown> = {
      $queryRaw: jest.fn().mockResolvedValue([]),
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
        findMany: overrides.chargeFindMany ?? jest.fn().mockResolvedValue([]),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        findUniqueOrThrow: jest.fn().mockResolvedValue({
          reconciliationState: 'MATCHED',
          shipmentId: 'shipment-1',
        }),
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
    };
    prisma.$transaction = jest.fn((fn: (tx: unknown) => unknown) => fn(prisma));
    return {
      service: new CarrierReconciliationService(
        prisma as never,
        activityLog as never,
      ),
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
          chargeKind: 'BASE',
          currency: { code: 'SAR' },
        })
        .mockResolvedValue(null),
      // existing CONFIRMED base charge on the same shipment
      chargeFindMany: jest.fn().mockResolvedValue([
        {
          id: 'charge-1',
          chargeKind: 'BASE',
          chargeAmount: 30,
          currencyId: 'currency-1',
        },
      ]),
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
          updateMany: (args: {
            where: Record<string, unknown>;
            data: Record<string, unknown>;
          }) => unknown;
        };
      }
    ).carrierCharge.updateMany;
    expect(updateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        // Conditional: a charge CONFIRMED meanwhile is never moved (M1).
        where: { id: 'charge-1', reconciliationState: { not: 'CONFIRMED' } },
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

  it('unmatch({ proposedOnly }) refuses a charge that is CONFIRMED under the lock (bulk reject never reverses an approved cost)', async () => {
    const { service, prisma } = makeService({
      chargeFindFirst: jest.fn().mockResolvedValue({
        id: 'charge-1',
        shipmentId: 'shipment-1',
        reconciliationState: 'MATCHED',
      }),
    });
    (
      prisma.carrierCharge as { findUniqueOrThrow: jest.Mock }
    ).findUniqueOrThrow.mockResolvedValue({ reconciliationState: 'CONFIRMED' });

    await expect(
      service.unmatch('charge-1', 'user-1', { proposedOnly: true }),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(
      (prisma.carrierCharge as { update: jest.Mock }).update,
    ).not.toHaveBeenCalled();
  });

  it('confirm() with an expected Shipment refuses a charge rematched meanwhile', async () => {
    const { service } = makeService({
      chargeFindFirst: jest.fn().mockResolvedValue({
        id: 'charge-1',
        shipmentId: 'shipment-2',
        reconciliationState: 'MATCHED',
        chargeKind: 'BASE',
      }),
    });

    await expect(
      service.confirm('charge-1', 'user-1', 'shipment-1'),
    ).rejects.toBeInstanceOf(ConflictException);
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
          chargeKind: 'BASE',
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

  const baseOnShipment = () =>
    jest.fn().mockResolvedValue([
      {
        id: 'charge-1',
        chargeKind: 'BASE',
        chargeAmount: 30,
        currencyId: 'currency-1',
      },
    ]);
  const pendingCharge = (
    kind: string,
    amount: number,
    currencyId = 'currency-1',
  ) =>
    jest.fn().mockResolvedValue({
      id: 'charge-3',
      shipmentId: 'shipment-1',
      reconciliationState: 'MATCHED',
      chargeAmount: amount,
      chargeKind: kind,
      currencyId,
      currency: { code: 'SAR' },
    });

  it('confirm() accepts a late SURCHARGE on top of a CONFIRMED base charge', async () => {
    const { service } = makeService({
      chargeFindFirst: pendingCharge('SURCHARGE', 12),
      chargeFindMany: baseOnShipment(),
    });

    const result = await service.confirm('charge-3', 'user-1');

    expect(result.reconciliationState).toBe('CONFIRMED');
  });

  it('confirm() refuses a surcharge/credit without a confirmed base, in another currency, or a credit above the net cost', async () => {
    const orphan = makeService({
      chargeFindFirst: pendingCharge('SURCHARGE', 5),
    });
    await expect(orphan.service.confirm('charge-3', 'user-1')).rejects.toThrow(
      /base carrier charge/,
    );
    const mixed = makeService({
      chargeFindFirst: pendingCharge('SURCHARGE', 5, 'currency-2'),
      chargeFindMany: baseOnShipment(),
    });
    await expect(mixed.service.confirm('charge-3', 'user-1')).rejects.toThrow(
      /same currency/,
    );
    const tooBig = makeService({
      chargeFindFirst: pendingCharge('CREDIT', 31),
      chargeFindMany: baseOnShipment(),
    });
    await expect(tooBig.service.confirm('charge-3', 'user-1')).rejects.toThrow(
      /exceeds/,
    );
  });

  it('imports a negative amount as a CREDIT stored positive, and rejects an unknown Charge Kind', async () => {
    const { service, prisma } = makeService({});
    const header = `${CSV_HEADER},Charge Kind`;
    const csv = `${header}
Aramex,CR-1,TRACK-9,,-15,SAR,2026-01-02,
Aramex,X-1,TRACK-8,,5,SAR,2026-01-02,FEE`;

    const summary = await service.importCsv(csv, 'charges.csv', 'user-1');

    const create = (
      prisma as unknown as {
        carrierCharge: { create: jest.Mock };
      }
    ).carrierCharge.create;
    expect(create).toHaveBeenCalledTimes(1);
    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({
        // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment -- `expect.objectContaining()` is untyped by design
        data: expect.objectContaining({
          chargeKind: 'CREDIT',
          chargeAmount: 15,
        }),
      }),
    );
    expect(summary.errorRows).toHaveLength(1);
  });
});
