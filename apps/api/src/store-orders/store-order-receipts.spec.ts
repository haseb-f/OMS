import { BadRequestException, NotFoundException } from '@nestjs/common';
import { StoreOrdersService } from './store-orders.service';
import type { PrismaService } from '../prisma/prisma.service';
import type { ObjectStorageService } from '../common/storage/object-storage.service';
import { StoreOrderActivityType } from './activities/store-order-activity.service';

function jpegFile(name = 'photo.jpg'): Express.Multer.File {
  const buffer = Buffer.from([
    0xff, 0xd8, 0xff, 0xd9, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
  ]);
  return {
    buffer,
    originalname: name,
    size: buffer.length,
    mimetype: 'image/jpeg',
    fieldname: 'file',
    encoding: '7bit',
    destination: '',
    filename: name,
    path: '',
    stream: undefined as never,
  };
}

describe('StoreOrdersService receipts', () => {
  const orderId = '11111111-1111-1111-1111-111111111111';
  const userId = '22222222-2222-2222-2222-222222222222';
  const orderRow = {
    id: orderId,
    deletedAt: null,
    shippingStage: 'NOT_READY',
    shipments: [],
    items: [],
    receipts: [],
    currencyId: 'c1',
  };

  const prisma = {
    storeOrder: { findFirst: jest.fn() },
    storeOrderReceipt: {
      create: jest.fn(),
      findFirst: jest.fn(),
      update: jest.fn(),
    },
    payment: { findFirst: jest.fn() },
    shippingStatus: { findFirst: jest.fn() },
    $transaction: jest.fn(),
  };
  const activityService = { log: jest.fn() };
  const objectStorage = { put: jest.fn(), get: jest.fn(), delete: jest.fn() };

  const service = new StoreOrdersService(
    prisma as unknown as PrismaService,
    {} as never,
    {} as never,
    {} as never,
    activityService as never,
    {} as never,
    objectStorage as unknown as ObjectStorageService,
  );

  beforeEach(() => {
    jest.clearAllMocks();
    prisma.storeOrder.findFirst.mockResolvedValue(orderRow);
    prisma.shippingStatus.findFirst.mockResolvedValue(null);
    prisma.$transaction.mockImplementation(
      async (fn: (tx: typeof prisma) => unknown) => fn(prisma),
    );
  });

  it('persists upload metadata and writes activity', async () => {
    const created = {
      id: 'r1',
      fileUrl: 'storage:key',
      fileName: 'photo.jpg',
      mimeType: 'image/jpeg',
      fileSizeBytes: 12,
      storageKey: 'store-order-receipts/x/y.jpg',
      uploadedAt: new Date('2026-08-22T00:00:00.000Z'),
      uploadedBy: { fullName: 'Admin' },
    };
    prisma.storeOrderReceipt.create.mockResolvedValue(created);

    const result = await service.uploadReceipt(orderId, jpegFile(), userId);

    expect(objectStorage.put).toHaveBeenCalled();
    expect(activityService.log).toHaveBeenCalledWith(
      orderId,
      StoreOrderActivityType.RECEIPT_ATTACHED,
      expect.stringContaining('photo.jpg'),
      userId,
      prisma,
    );
    expect(result.source).toBe('UPLOAD');
    expect(result.fileName).toBe('photo.jpg');
    expect(result.mimeType).toBe('image/jpeg');
    expect(result.createdBy).toBe('Admin');
    expect(result.fileUrl).toContain(
      `/store-orders/${orderId}/receipts/r1/file`,
    );
  });

  it('deletes the stored object when the database write fails', async () => {
    prisma.storeOrderReceipt.create.mockRejectedValue(new Error('db down'));
    await expect(
      service.uploadReceipt(orderId, jpegFile(), userId),
    ).rejects.toThrow('db down');
    expect(objectStorage.delete).toHaveBeenCalled();
  });

  it('keeps URL-based receipts downloadable via the stored URL', async () => {
    prisma.storeOrderReceipt.create.mockResolvedValue({
      id: 'url-1',
      fileUrl: 'https://files.example/old.pdf',
      fileName: 'old.pdf',
      mimeType: null,
      fileSizeBytes: null,
      storageKey: null,
      uploadedAt: new Date(),
      uploadedBy: null,
    });
    const result = await service.addReceipt(
      orderId,
      { fileUrl: 'https://files.example/old.pdf', fileName: 'old.pdf' },
      userId,
    );
    expect(result.source).toBe('URL');
    expect(result.fileUrl).toBe('https://files.example/old.pdf');
  });

  it('rejects download of a URL-only receipt through the binary endpoint', async () => {
    prisma.storeOrderReceipt.findFirst.mockResolvedValue({
      id: 'url-1',
      storageKey: null,
      storeOrderId: orderId,
      deletedAt: null,
    });
    await expect(
      service.getReceiptFile(orderId, 'url-1'),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('blocks download/delete when the order is missing (unauthorized/unknown)', async () => {
    prisma.storeOrder.findFirst.mockResolvedValue(null);
    await expect(service.getReceiptFile(orderId, 'r1')).rejects.toBeInstanceOf(
      NotFoundException,
    );
    await expect(
      service.archiveReceipt(orderId, 'r1', userId),
    ).rejects.toBeInstanceOf(NotFoundException);
    await expect(
      service.uploadReceipt(orderId, jpegFile(), userId),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('archives an uploaded receipt and deletes the object', async () => {
    prisma.storeOrderReceipt.findFirst.mockResolvedValue({
      id: 'r1',
      fileName: 'photo.jpg',
      storageKey: 'k',
      deletedAt: null,
    });
    await service.archiveReceipt(orderId, 'r1', userId);
    expect(prisma.storeOrderReceipt.update).toHaveBeenCalledWith({
      where: { id: 'r1' },
      data: { deletedAt: expect.any(Date) },
    });
    expect(objectStorage.delete).toHaveBeenCalledWith('k');
    expect(activityService.log).toHaveBeenCalledWith(
      orderId,
      StoreOrderActivityType.RECEIPT_REMOVED,
      expect.stringContaining('photo.jpg'),
      userId,
      prisma,
    );
  });

  it('returns the order after a valid note so the timeline can refresh', async () => {
    prisma.storeOrder.findFirst.mockResolvedValue({
      ...orderRow,
      receipts: [],
    });
    activityService.log.mockResolvedValue({ id: 'a1' });
    const updated = await service.addNote(
      orderId,
      { text: 'Follow up tomorrow' },
      userId,
    );
    expect(activityService.log).toHaveBeenCalledWith(
      orderId,
      StoreOrderActivityType.NOTE_ADDED,
      'Follow up tomorrow',
      userId,
    );
    expect(updated.id).toBe(orderId);
  });
});
