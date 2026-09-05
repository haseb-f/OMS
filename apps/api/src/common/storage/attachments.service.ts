import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PaymentStatus, Prisma } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { PrismaService } from '../../prisma/prisma.service';
import { SalesScopeService } from '../../sales-scope/sales-scope.service';
import {
  ATTACHMENT_MAX_PER_PAYMENT,
  ATTACHMENT_STAGING_TTL_MS,
  validateAttachmentUpload,
} from './file-validation';
import { ObjectStorageService } from './object-storage.service';

export const PAYMENT_RECEIPT_TYPE = 'PAYMENT_RECEIPT';

const LOCKED_PAYMENT_STATUSES: PaymentStatus[] = [PaymentStatus.VERIFIED];

type Db = Prisma.TransactionClient | PrismaService;

@Injectable()
export class AttachmentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly objectStorage: ObjectStorageService,
    private readonly salesScope: SalesScopeService,
  ) {}

  async createStaging(file: Express.Multer.File | undefined, userId: string) {
    await this.cleanupExpiredStaging();
    const validated = validateAttachmentUpload(file);
    const id = randomUUID();
    const storageKey = `attachments/staging/${userId}/${id}${validated.extension}`;
    await this.objectStorage.put(storageKey, file!.buffer, validated.mimeType);
    try {
      const row = await this.prisma.attachment.create({
        data: {
          id,
          fileName: `${id}${validated.extension}`,
          originalName: validated.originalName,
          mimeType: validated.mimeType,
          sizeBytes: validated.sizeBytes,
          storageProvider: this.objectStorage.provider(),
          storageKey,
          uploadedById: userId,
          expiresAt: new Date(Date.now() + ATTACHMENT_STAGING_TTL_MS),
        },
      });
      return this.toStagingDto(row);
    } catch (error) {
      await this.objectStorage.delete(storageKey);
      throw error;
    }
  }

  async discardStaging(id: string, userId: string) {
    const row = await this.prisma.attachment.findFirst({
      where: { id, deletedAt: null },
    });
    if (!row) throw new NotFoundException('Attachment not found.');
    if (row.finalizedAt) {
      throw new BadRequestException(
        'Cannot remove a finalized receipt from staging.',
      );
    }
    if (row.uploadedById !== userId) {
      throw new ForbiddenException('ليس لديك صلاحية لعرض هذا الإيصال');
    }
    await this.prisma.attachment.update({
      where: { id },
      data: { deletedAt: new Date(), deletedById: userId },
    });
    await this.objectStorage.delete(row.storageKey);
    return { id };
  }

  async finalizeForPayment(
    paymentId: string,
    storeOrderId: string | null,
    stagingIds: string[],
    userId: string,
    tx: Db = this.prisma,
  ) {
    const uniqueIds = [...new Set(stagingIds.filter(Boolean))];
    if (uniqueIds.length === 0) return [];
    await this.assertPaymentCapacity(paymentId, uniqueIds.length, tx);
    const rows = await tx.attachment.findMany({
      where: {
        id: { in: uniqueIds },
        uploadedById: userId,
        deletedAt: null,
        finalizedAt: null,
      },
    });
    if (rows.length !== uniqueIds.length) {
      throw new BadRequestException('تعذر رفع الإيصال، حاول مرة أخرى');
    }
    const created = [];
    for (const row of rows) {
      await tx.attachment.update({
        where: { id: row.id },
        data: { finalizedAt: new Date(), expiresAt: null },
      });
      const paymentAttachment = await tx.paymentAttachment.create({
        data: {
          paymentId,
          attachmentId: row.id,
          uploadedById: userId,
          fileUrl: `storage:${row.storageKey}`,
          fileName: row.originalName,
          attachmentType: PAYMENT_RECEIPT_TYPE,
        },
      });
      if (storeOrderId) {
        await tx.storeOrderReceipt.create({
          data: {
            storeOrderId,
            paymentId,
            attachmentId: row.id,
            fileUrl: `storage:${row.storageKey}`,
            fileName: row.originalName,
            mimeType: row.mimeType,
            fileSizeBytes: row.sizeBytes,
            storageKey: row.storageKey,
            uploadedById: userId,
          },
        });
      }
      created.push(paymentAttachment);
    }
    return created;
  }

  async attachStagingToPayment(
    paymentId: string,
    stagingIds: string[],
    userId: string,
  ) {
    const payment = await this.prisma.payment.findFirst({
      where: { id: paymentId, deletedAt: null },
      include: { storeOrder: { select: { id: true, employeeId: true } } },
    });
    if (!payment) throw new NotFoundException('Payment not found.');
    await this.assertCanMutateReceipts(payment, userId);
    return this.finalizeForPayment(
      paymentId,
      payment.storeOrderId,
      stagingIds,
      userId,
    );
  }

  async uploadForPayment(
    paymentId: string,
    file: Express.Multer.File | undefined,
    userId: string,
  ) {
    const payment = await this.prisma.payment.findFirst({
      where: { id: paymentId, deletedAt: null },
      include: {
        storeOrder: { select: { id: true, employeeId: true } },
      },
    });
    if (!payment) throw new NotFoundException('Payment not found.');
    await this.assertCanMutateReceipts(payment, userId);
    await this.assertPaymentCapacity(paymentId, 1);
    const staging = await this.createStaging(file, userId);
    try {
      const [link] = await this.finalizeForPayment(
        paymentId,
        payment.storeOrderId,
        [staging.id],
        userId,
      );
      return this.toPaymentAttachmentDto(link.id, staging);
    } catch (error) {
      await this.discardStaging(staging.id, userId).catch(() => undefined);
      throw error;
    }
  }

  async listForPayment(paymentId: string, userId: string) {
    const payment = await this.requirePaymentAccess(paymentId, userId);
    const rows = await this.prisma.paymentAttachment.findMany({
      where: { paymentId: payment.id, deletedAt: null },
      orderBy: { createdAt: 'asc' },
      include: {
        uploadedBy: { select: { fullName: true } },
        attachment: true,
      },
    });
    return rows.map((row) => this.mapPaymentAttachment(row));
  }

  async getFile(attachmentId: string, userId: string) {
    const attachment = await this.prisma.attachment.findFirst({
      where: { id: attachmentId, deletedAt: null },
    });
    if (!attachment) throw new NotFoundException('Attachment not found.');
    if (!attachment.finalizedAt) {
      if (attachment.uploadedById !== userId) {
        throw new ForbiddenException('ليس لديك صلاحية لعرض هذا الإيصال');
      }
    } else {
      await this.assertCanViewAttachment(attachment.id, userId);
    }
    const body = await this.objectStorage.get(attachment.storageKey);
    return {
      body,
      mimeType: attachment.mimeType,
      fileName: attachment.originalName,
    };
  }

  async archivePaymentAttachment(
    paymentId: string,
    paymentAttachmentId: string,
    userId: string,
    reason?: string,
  ) {
    const payment = await this.prisma.payment.findFirst({
      where: { id: paymentId, deletedAt: null },
      include: { storeOrder: { select: { id: true, employeeId: true } } },
    });
    if (!payment) throw new NotFoundException('Payment not found.');
    const link = await this.prisma.paymentAttachment.findFirst({
      where: { id: paymentAttachmentId, paymentId, deletedAt: null },
      include: { attachment: true },
    });
    if (!link) throw new NotFoundException('Attachment not found.');
    const scope = await this.salesScope.resolve(userId);
    const locked = LOCKED_PAYMENT_STATUSES.includes(payment.status);
    if (locked && !scope.canManagePaymentEvidence) {
      throw new ForbiddenException(
        'لا يمكن حذف إيصال سداد بعد التحقق إلا بصلاحية مالية.',
      );
    }
    if (locked && !reason?.trim()) {
      throw new BadRequestException('سبب الحذف مطلوب بعد التحقق من الدفعة.');
    }
    if (!locked) {
      await this.assertCanMutateReceipts(payment, userId);
    }
    const now = new Date();
    await this.prisma.$transaction(async (tx) => {
      await tx.paymentAttachment.update({
        where: { id: link.id },
        data: { deletedAt: now },
      });
      if (link.attachmentId) {
        await tx.attachment.update({
          where: { id: link.attachmentId },
          data: {
            deletedAt: now,
            deletedById: userId,
            deletionReason: reason?.trim() || null,
          },
        });
        await tx.storeOrderReceipt.updateMany({
          where: { attachmentId: link.attachmentId, deletedAt: null },
          data: { deletedAt: now },
        });
      }
    });
    if (!locked && link.attachment?.storageKey) {
      await this.objectStorage.delete(link.attachment.storageKey);
    }
    return { id: paymentAttachmentId };
  }

  private async assertPaymentCapacity(
    paymentId: string,
    incoming: number,
    tx: Db = this.prisma,
  ) {
    const count = await tx.paymentAttachment.count({
      where: { paymentId, deletedAt: null },
    });
    if (count + incoming > ATTACHMENT_MAX_PER_PAYMENT) {
      throw new BadRequestException(
        `لا يمكن إرفاق أكثر من ${ATTACHMENT_MAX_PER_PAYMENT} إيصالات لكل دفعة.`,
      );
    }
  }

  private async requirePaymentAccess(paymentId: string, userId: string) {
    const payment = await this.prisma.payment.findFirst({
      where: { id: paymentId, deletedAt: null },
      include: { storeOrder: { select: { id: true, employeeId: true } } },
    });
    if (!payment) throw new NotFoundException('Payment not found.');
    const scope = await this.salesScope.resolve(userId);
    if (payment.storeOrder) {
      this.salesScope.assertPaymentEvidenceAccess(scope, payment.storeOrder);
    } else if (!scope.canViewPaymentEvidence) {
      throw new ForbiddenException('ليس لديك صلاحية لعرض هذا الإيصال');
    }
    return payment;
  }

  private async assertCanViewAttachment(attachmentId: string, userId: string) {
    const link = await this.prisma.paymentAttachment.findFirst({
      where: { attachmentId, deletedAt: null },
      include: {
        payment: {
          include: { storeOrder: { select: { id: true, employeeId: true } } },
        },
      },
    });
    const receipt = await this.prisma.storeOrderReceipt.findFirst({
      where: { attachmentId, deletedAt: null },
      include: { storeOrder: { select: { id: true, employeeId: true } } },
    });
    const scope = await this.salesScope.resolve(userId);
    if (link?.payment.storeOrder) {
      this.salesScope.assertPaymentEvidenceAccess(
        scope,
        link.payment.storeOrder,
      );
      return;
    }
    if (receipt?.storeOrder) {
      this.salesScope.assertPaymentEvidenceAccess(scope, receipt.storeOrder);
      return;
    }
    if (scope.canManagePaymentEvidence) return;
    throw new ForbiddenException('ليس لديك صلاحية لعرض هذا الإيصال');
  }

  private async assertCanMutateReceipts(
    payment: {
      status: PaymentStatus;
      storeOrder: { id: string; employeeId: string | null } | null;
    },
    userId: string,
  ) {
    const scope = await this.salesScope.resolve(userId);
    if (
      LOCKED_PAYMENT_STATUSES.includes(payment.status) &&
      !scope.canManagePaymentEvidence
    ) {
      throw new ForbiddenException(
        'لا يمكن تعديل إيصالات دفعة تم التحقق منها.',
      );
    }
    if (payment.storeOrder) {
      this.salesScope.assertPaymentEvidenceAccess(scope, payment.storeOrder);
      return;
    }
    if (!scope.canViewPaymentEvidence) {
      throw new ForbiddenException('ليس لديك صلاحية لعرض هذا الإيصال');
    }
  }

  async cleanupExpiredStaging() {
    const expired = await this.prisma.attachment.findMany({
      where: {
        finalizedAt: null,
        deletedAt: null,
        expiresAt: { lt: new Date() },
      },
      take: 20,
    });
    for (const row of expired) {
      await this.prisma.attachment.update({
        where: { id: row.id },
        data: { deletedAt: new Date() },
      });
      await this.objectStorage.delete(row.storageKey).catch(() => undefined);
    }
  }

  private toStagingDto(row: {
    id: string;
    originalName: string;
    mimeType: string;
    sizeBytes: number;
    createdAt: Date;
  }) {
    return {
      id: row.id,
      originalName: row.originalName,
      mimeType: row.mimeType,
      sizeBytes: row.sizeBytes,
      status: 'STAGING' as const,
      createdAt: row.createdAt,
    };
  }

  private toPaymentAttachmentDto(
    paymentAttachmentId: string,
    staging: {
      id: string;
      originalName: string;
      mimeType: string;
      sizeBytes: number;
    },
  ) {
    return {
      id: paymentAttachmentId,
      attachmentId: staging.id,
      fileName: staging.originalName,
      mimeType: staging.mimeType,
      sizeBytes: staging.sizeBytes,
      source: 'UPLOAD' as const,
      attachmentType: PAYMENT_RECEIPT_TYPE,
    };
  }

  private mapPaymentAttachment(row: {
    id: string;
    fileUrl: string;
    fileName: string | null;
    attachmentType: string;
    createdAt: Date;
    uploadedBy: { fullName: string } | null;
    attachment: {
      id: string;
      originalName: string;
      mimeType: string;
      sizeBytes: number;
      uploadedById: string;
      createdAt: Date;
    } | null;
  }) {
    const uploaded = Boolean(row.attachment);
    return {
      id: row.id,
      attachmentId: row.attachment?.id ?? null,
      fileName: row.attachment?.originalName ?? row.fileName,
      mimeType: row.attachment?.mimeType ?? null,
      sizeBytes: row.attachment?.sizeBytes ?? null,
      source: uploaded ? ('UPLOAD' as const) : ('URL' as const),
      fileUrl: uploaded
        ? `/attachments/${row.attachment!.id}/file`
        : row.fileUrl,
      attachmentType: row.attachmentType,
      uploadedBy: row.uploadedBy?.fullName ?? null,
      createdAt: row.attachment?.createdAt ?? row.createdAt,
    };
  }
}
