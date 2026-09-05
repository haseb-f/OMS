import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { PaymentStatus } from '@prisma/client';
import { AttachmentsService } from './attachments.service';
import type { PrismaService } from '../../prisma/prisma.service';
import type { ObjectStorageService } from './object-storage.service';
import type { SalesScopeService } from '../../sales-scope/sales-scope.service';

function jpegFile(name = 'receipt.jpg'): Express.Multer.File {
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

describe('AttachmentsService', () => {
  const userId = '11111111-1111-1111-1111-111111111111';
  const paymentId = '22222222-2222-2222-2222-222222222222';
  const orderId = '33333333-3333-3333-3333-333333333333';

  const prisma = {
    attachment: {
      create: jest.fn(),
      findMany: jest.fn(),
      findFirst: jest.fn(),
      update: jest.fn(),
    },
    payment: { findFirst: jest.fn() },
    paymentAttachment: {
      create: jest.fn(),
      count: jest.fn(),
      findMany: jest.fn(),
      findFirst: jest.fn(),
      update: jest.fn(),
    },
    storeOrderReceipt: {
      create: jest.fn(),
      findFirst: jest.fn(),
      updateMany: jest.fn(),
    },
    $transaction: jest.fn(),
  };
  const objectStorage = {
    put: jest.fn(),
    get: jest.fn(),
    delete: jest.fn(),
    provider: jest.fn().mockReturnValue('local'),
  };
  const salesScope = {
    resolve: jest.fn(),
    assertPaymentEvidenceAccess: jest.fn(),
  };

  const service = new AttachmentsService(
    prisma as unknown as PrismaService,
    objectStorage as unknown as ObjectStorageService,
    salesScope as unknown as SalesScopeService,
  );

  beforeEach(() => {
    jest.clearAllMocks();
    prisma.attachment.findMany.mockResolvedValue([]);
    prisma.paymentAttachment.count.mockResolvedValue(0);
    salesScope.resolve.mockResolvedValue({
      canViewPaymentEvidence: true,
      canManagePaymentEvidence: false,
      kind: 'OWN',
    });
  });

  it('stores a staging upload with a generated key and original name', async () => {
    prisma.attachment.create.mockImplementation(({ data }) =>
      Promise.resolve({ ...data, createdAt: new Date() }),
    );
    const result = await service.createStaging(jpegFile('إيصال.jpg'), userId);
    expect(objectStorage.put).toHaveBeenCalledWith(
      expect.stringMatching(/^attachments\/staging\//),
      expect.any(Buffer),
      'image/jpeg',
    );
    const putCall = objectStorage.put.mock.calls.at(0) as
      [string, Buffer, string?] | undefined;
    expect(putCall?.[0]).toBeDefined();
    expect(putCall?.[0]).not.toContain('إيصال');
    expect(result.originalName).toBe('إيصال.jpg');
    expect(result.status).toBe('STAGING');
  });

  it('rejects executables on staging upload', async () => {
    await expect(
      service.createStaging(
        {
          ...jpegFile('malware.exe'),
          buffer: Buffer.from('MZ'),
          originalname: 'malware.exe',
          mimetype: 'application/x-msdownload',
        },
        userId,
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(objectStorage.put).not.toHaveBeenCalled();
  });

  it('links multiple staging files to one payment without overwrite', async () => {
    const rows = [
      {
        id: 'a1',
        storageKey: 'k1',
        originalName: 'a.jpg',
        mimeType: 'image/jpeg',
        sizeBytes: 12,
      },
      {
        id: 'a2',
        storageKey: 'k2',
        originalName: 'b.pdf',
        mimeType: 'application/pdf',
        sizeBytes: 20,
      },
    ];
    prisma.attachment.findMany.mockResolvedValue(rows);
    prisma.paymentAttachment.create
      .mockResolvedValueOnce({ id: 'p1' })
      .mockResolvedValueOnce({ id: 'p2' });
    const created = await service.finalizeForPayment(
      paymentId,
      orderId,
      ['a1', 'a2'],
      userId,
      prisma as never,
    );
    expect(created).toHaveLength(2);
    expect(prisma.paymentAttachment.create).toHaveBeenCalledTimes(2);
    expect(prisma.storeOrderReceipt.create).toHaveBeenCalledTimes(2);
    expect(prisma.attachment.update).toHaveBeenCalledTimes(2);
  });

  it('enforces the per-payment file cap', async () => {
    prisma.paymentAttachment.count.mockResolvedValue(10);
    await expect(
      service.finalizeForPayment(
        paymentId,
        orderId,
        ['a1'],
        userId,
        prisma as never,
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('blocks shipping-only users from viewing receipts', async () => {
    prisma.payment.findFirst.mockResolvedValue({
      id: paymentId,
      storeOrder: { id: orderId, employeeId: userId },
    });
    salesScope.assertPaymentEvidenceAccess.mockImplementation(() => {
      throw new ForbiddenException('ليس لديك صلاحية لعرض هذا الإيصال');
    });
    await expect(
      service.listForPayment(paymentId, userId),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('blocks a sales agent from deleting verified financial evidence', async () => {
    prisma.payment.findFirst.mockResolvedValue({
      id: paymentId,
      status: PaymentStatus.VERIFIED,
      storeOrder: { id: orderId, employeeId: userId },
    });
    prisma.paymentAttachment.findFirst.mockResolvedValue({
      id: 'pa1',
      attachmentId: 'a1',
      attachment: { storageKey: 'k' },
    });
    await expect(
      service.archivePaymentAttachment(paymentId, 'pa1', userId),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(objectStorage.delete).not.toHaveBeenCalled();
  });
});
