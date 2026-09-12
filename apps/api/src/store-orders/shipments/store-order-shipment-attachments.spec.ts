import { NotFoundException } from '@nestjs/common';
import { StoreOrderShipmentOperationsService } from './store-order-shipment-operations.service';
import { StoreOrderActivityType } from '../activities/store-order-activity.service';
import type { PrismaService } from '../../prisma/prisma.service';
import type { StoreOrderShipmentsService } from './store-order-shipments.service';
import type { StoreOrderActivityService } from '../activities/store-order-activity.service';
import type { AttachmentsService } from '../../common/storage/attachments.service';

/**
 * Shipping operational evidence (Part 6/9 of the Shipping Quick Edit task) —
 * the orchestration layer must (a) auto-create the current shipment on
 * first use exactly like assignShippingCompany/addTrackingNumber, (b) call
 * the canonical AttachmentsService rather than a second storage path, and
 * (c) log a distinct SHIPMENT_ATTACHMENT_ADDED/REMOVED activity — never the
 * RECEIPT_ATTACHED/REMOVED types reserved for Payment/Order receipts.
 */
describe('StoreOrderShipmentOperationsService attachments', () => {
  const storeOrderId = '55555555-5555-5555-5555-555555555555';
  const shipmentId = '66666666-6666-6666-6666-666666666666';
  const userId = '77777777-7777-7777-7777-777777777777';

  const prisma = {
    storeOrder: { findFirst: jest.fn() },
  };
  const shipmentsService = {
    getOrCreateCurrent: jest.fn(),
    getCurrent: jest.fn(),
  };
  const activityService = { log: jest.fn() };
  const attachments = {
    uploadForShipment: jest.fn(),
    attachStagingToShipment: jest.fn(),
    listForShipment: jest.fn(),
    removeShipmentAttachment: jest.fn(),
  };

  const service = new StoreOrderShipmentOperationsService(
    prisma as unknown as PrismaService,
    shipmentsService as unknown as StoreOrderShipmentsService,
    activityService as unknown as StoreOrderActivityService,
    attachments as unknown as AttachmentsService,
  );

  beforeEach(() => {
    jest.clearAllMocks();
    prisma.storeOrder.findFirst.mockResolvedValue({ id: storeOrderId });
  });

  it('uploads to the current shipment, creating it on first use, and logs SHIPMENT_ATTACHMENT_ADDED', async () => {
    shipmentsService.getOrCreateCurrent.mockResolvedValue({
      shipment: { id: shipmentId, attemptNumber: 1 },
      created: true,
    });
    attachments.uploadForShipment.mockResolvedValue({
      id: 'sa1',
      fileName: 'waybill.pdf',
    });

    const result = await service.uploadAttachment(
      storeOrderId,
      {} as Express.Multer.File,
      userId,
    );

    expect(attachments.uploadForShipment).toHaveBeenCalledWith(
      shipmentId,
      {},
      userId,
    );
    expect(activityService.log).toHaveBeenCalledWith(
      storeOrderId,
      StoreOrderActivityType.SHIPMENT_CREATED,
      expect.any(String),
      userId,
      prisma,
      'MANUAL',
    );
    expect(activityService.log).toHaveBeenCalledWith(
      storeOrderId,
      StoreOrderActivityType.SHIPMENT_ATTACHMENT_ADDED,
      expect.stringContaining('waybill.pdf'),
      userId,
      prisma,
      'MANUAL',
    );
    expect(result).toEqual({ id: 'sa1', fileName: 'waybill.pdf' });
  });

  it('does not log SHIPMENT_CREATED when a shipment already existed', async () => {
    shipmentsService.getOrCreateCurrent.mockResolvedValue({
      shipment: { id: shipmentId, attemptNumber: 2 },
      created: false,
    });
    attachments.uploadForShipment.mockResolvedValue({ id: 'sa2' });

    await service.uploadAttachment(
      storeOrderId,
      {} as Express.Multer.File,
      userId,
    );

    expect(activityService.log).not.toHaveBeenCalledWith(
      storeOrderId,
      StoreOrderActivityType.SHIPMENT_CREATED,
      expect.anything(),
      expect.anything(),
      expect.anything(),
      expect.anything(),
    );
  });

  it('lists attachments for the current shipment, returning an empty list when no shipment exists yet', async () => {
    shipmentsService.getCurrent.mockResolvedValue(null);
    const result = await service.listAttachments(storeOrderId);
    expect(result).toEqual([]);
    expect(attachments.listForShipment).not.toHaveBeenCalled();
  });

  it('removes an attachment from the current shipment and logs SHIPMENT_ATTACHMENT_REMOVED', async () => {
    shipmentsService.getCurrent.mockResolvedValue({ id: shipmentId });
    attachments.removeShipmentAttachment.mockResolvedValue({ id: 'sa1' });

    const result = await service.removeAttachment(storeOrderId, 'sa1', userId);

    expect(attachments.removeShipmentAttachment).toHaveBeenCalledWith(
      shipmentId,
      'sa1',
      userId,
    );
    expect(activityService.log).toHaveBeenCalledWith(
      storeOrderId,
      StoreOrderActivityType.SHIPMENT_ATTACHMENT_REMOVED,
      expect.any(String),
      userId,
      prisma,
      'MANUAL',
    );
    expect(result).toEqual({ id: 'sa1' });
  });

  it('refuses to remove an attachment when no shipment exists yet', async () => {
    shipmentsService.getCurrent.mockResolvedValue(null);
    await expect(
      service.removeAttachment(storeOrderId, 'sa1', userId),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(attachments.removeShipmentAttachment).not.toHaveBeenCalled();
  });
});
