import { ConflictException } from '@nestjs/common';
import { WarehouseRole } from '@prisma/client';
import { MasterDataCrudService } from '../master-data/master-data-crud.service';
import { WarehousesService } from './warehouses.service';

/** R15 (D15-4) — the system warehouses that carry the stock lifecycle are protected. */
describe('WarehousesService — system warehouses', () => {
  const role = { value: WarehouseRole.TRANSIT as WarehouseRole };
  const prisma = {
    warehouse: {
      findUnique: jest.fn(() =>
        Promise.resolve({ role: role.value, code: 'WH-TRANSIT' }),
      ),
    },
  };
  const service = new WarehousesService(
    prisma as never,
    {} as never,
    {} as never,
  );
  const update = jest
    .spyOn(MasterDataCrudService.prototype, 'update')
    .mockResolvedValue({});
  const archive = jest
    .spyOn(MasterDataCrudService.prototype, 'archive')
    .mockResolvedValue({});

  beforeEach(() => {
    update.mockClear();
    archive.mockClear();
  });

  it('refuses deactivating, archiving or defaulting a transit / damaged warehouse', async () => {
    for (const value of [WarehouseRole.TRANSIT, WarehouseRole.DAMAGED]) {
      role.value = value;
      await expect(
        service.update('w', { isActive: false }),
      ).rejects.toBeInstanceOf(ConflictException);
      await expect(
        service.update('w', { isDefault: true }),
      ).rejects.toBeInstanceOf(ConflictException);
      await expect(service.archive('w')).rejects.toBeInstanceOf(
        ConflictException,
      );
    }
    expect(update).not.toHaveBeenCalled();
    expect(archive).not.toHaveBeenCalled();
  });

  it('still lets a system warehouse be renamed, and stock warehouses change freely', async () => {
    role.value = WarehouseRole.TRANSIT;
    await service.update('w', { name: 'Goods in transit' });
    role.value = WarehouseRole.STOCK;
    await service.update('w', { isActive: false, isDefault: true });
    await service.archive('w');
    expect(update).toHaveBeenCalledTimes(2);
    expect(archive).toHaveBeenCalledTimes(1);
  });
});
