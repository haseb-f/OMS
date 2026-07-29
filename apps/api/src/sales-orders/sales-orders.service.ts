import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  LeadStatus,
  PaymentStatus,
  Prisma,
  SalesOrderStatus,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import {
  SalesOrderActivityService,
  SalesOrderActivityType,
} from './activities/sales-order-activity.service';
import { SalesOrderStatusHistoryService } from './status-history/sales-order-status-history.service';
import { ShipmentsService } from './shipments/shipments.service';
import { SalesOrderAttachmentsService } from './attachments/sales-order-attachments.service';
import { SalesOrderNotesService } from './notes/sales-order-notes.service';
import { CreateSalesOrderDto } from './dto/create-sales-order.dto';
import { AssignShippingEmployeeDto } from './dto/assign-shipping-employee.dto';
import { AssignShippingCompanyDto } from './dto/assign-shipping-company.dto';
import { AddTrackingNumberDto } from './dto/add-tracking-number.dto';
import { UploadShippingLabelDto } from './dto/upload-shipping-label.dto';
import { AddShippingCostDto } from './dto/add-shipping-cost.dto';
import { CreateSalesOrderNoteDto } from './dto/create-sales-order-note.dto';
import { CreateSalesOrderAttachmentDto } from './dto/create-sales-order-attachment.dto';

@Injectable()
export class SalesOrdersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly activityService: SalesOrderActivityService,
    private readonly statusHistoryService: SalesOrderStatusHistoryService,
    private readonly shipmentsService: ShipmentsService,
    private readonly attachmentsService: SalesOrderAttachmentsService,
    private readonly notesService: SalesOrderNotesService,
  ) {}

  private async generateOrderNumber(
    tx: Prisma.TransactionClient,
  ): Promise<string> {
    const result = await tx.$queryRaw<
      { nextval: bigint }[]
    >`SELECT nextval('sales_order_number_seq')`;
    return `SO-${result[0].nextval.toString().padStart(6, '0')}`;
  }

  /** Shared by simple status-changing operations: updates SalesOrder.status, records
   *  StatusHistory (decision #1), and logs the operation's own named activity. */
  private async transitionStatus(
    id: string,
    newStatus: SalesOrderStatus,
    activityType: string,
    activityDescription: string,
    activityMetadata: Record<string, unknown> = {},
  ) {
    const existing = await this.findOne(id);
    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.salesOrder.update({
        where: { id },
        data: { status: newStatus },
      });
      await this.statusHistoryService.record(
        id,
        existing.status,
        newStatus,
        tx,
      );
      await this.activityService.log(
        id,
        activityType,
        activityDescription,
        {
          fromStatus: existing.status,
          toStatus: newStatus,
          ...activityMetadata,
        },
        tx,
      );
      return updated;
    });
  }

  /** Business operation: Create Order From Paid Lead. Only creation path — no generic CRUD create. */
  async create(dto: CreateSalesOrderDto) {
    const lead = await this.prisma.lead.findFirst({
      where: { id: dto.leadId, deletedAt: null },
    });
    if (!lead) {
      throw new BadRequestException('Lead not found.');
    }
    if (lead.status !== LeadStatus.PAID) {
      throw new BadRequestException(
        'Sales Orders can only be created from a Lead with status PAID.',
      );
    }

    // Decision #4: snapshot who verified the payment that authorized this order, if any.
    const verifiedPayment = await this.prisma.payment.findFirst({
      where: {
        leadId: lead.id,
        status: PaymentStatus.VERIFIED,
        deletedAt: null,
      },
      orderBy: { verifiedAt: 'desc' },
    });

    try {
      return await this.prisma.$transaction(async (tx) => {
        const orderNumber = await this.generateOrderNumber(tx);

        const order = await tx.salesOrder.create({
          data: {
            orderNumber,
            leadId: lead.id,
            // Snapshot fields — copied from the Lead now, never re-read through it (decision #13).
            customerName: lead.customerName,
            mobileNumber: lead.mobileNumber,
            countryId: lead.countryId,
            city: lead.city,
            address: lead.address,
            currencyId: lead.currencyId,
            salesEmployeeId: lead.salesEmployeeId,
            costCenterId: dto.costCenterId,
            projectId: dto.projectId,
            paymentMethodId: dto.paymentMethodId,
            warehouseId: dto.warehouseId,
            createdById: dto.createdById,
            paymentVerifiedById: verifiedPayment?.verifiedById,
            status: SalesOrderStatus.CREATED,
            items: {
              create: dto.items.map((item) => ({
                productId: item.productId,
                quantity: item.quantity,
                unitPrice: item.unitPrice,
                discount: item.discount ?? 0,
                offer: item.offer,
              })),
            },
          },
          include: { items: true },
        });

        await this.statusHistoryService.record(
          order.id,
          null,
          SalesOrderStatus.CREATED,
          tx,
        );
        await this.activityService.log(
          order.id,
          SalesOrderActivityType.ORDER_CREATED,
          `Sales Order ${order.orderNumber} created from Lead ${lead.leadNumber}`,
          { leadId: lead.id },
          tx,
        );

        return order;
      });
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2003'
      ) {
        throw new BadRequestException(
          'Invalid cost center, project, payment method, warehouse, or createdBy reference.',
        );
      }
      throw error;
    }
  }

  findAll() {
    return this.prisma.salesOrder.findMany({ where: { deletedAt: null } });
  }

  async findOne(id: string) {
    const order = await this.prisma.salesOrder.findFirst({
      where: { id, deletedAt: null },
    });
    if (!order) {
      throw new NotFoundException(`Sales Order ${id} not found`);
    }
    return order;
  }

  /** Business operation: Ready For Shipping. */
  readyForShipping(id: string) {
    return this.transitionStatus(
      id,
      SalesOrderStatus.READY_FOR_SHIPPING,
      SalesOrderActivityType.READY_FOR_SHIPPING,
      'Ready For Shipping',
    );
  }

  /** Business operation: Assign Shipping Employee — must be an active (non-deleted) User. */
  async assignShippingEmployee(id: string, dto: AssignShippingEmployeeDto) {
    await this.findOne(id);
    const shippingEmployee = await this.prisma.user.findFirst({
      where: { id: dto.shippingEmployeeId, deletedAt: null },
    });
    if (!shippingEmployee) {
      throw new BadRequestException(
        'Shipping employee not found or is not active.',
      );
    }

    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.salesOrder.update({
        where: { id },
        data: { shippingEmployeeId: dto.shippingEmployeeId },
      });
      await this.activityService.log(
        id,
        SalesOrderActivityType.SHIPPING_EMPLOYEE_ASSIGNED,
        'Shipping employee assigned',
        { shippingEmployeeId: dto.shippingEmployeeId },
        tx,
      );
      return updated;
    });
  }

  /** Business operation: Assign Shipping Company — decision #2, Reference Data only, never free text. */
  async assignShippingCompany(id: string, dto: AssignShippingCompanyDto) {
    await this.findOne(id);
    return this.prisma.$transaction(async (tx) => {
      const { shipment, created } =
        await this.shipmentsService.assignShippingCompany(
          id,
          dto.shippingCompanyId,
          tx,
        );
      if (created) {
        await this.activityService.log(
          id,
          SalesOrderActivityType.SHIPMENT_CREATED,
          `Shipment #${shipment.attemptNumber} created`,
          { shipmentId: shipment.id, attemptNumber: shipment.attemptNumber },
          tx,
        );
      }
      await this.activityService.log(
        id,
        SalesOrderActivityType.SHIPPING_COMPANY_ASSIGNED,
        'Shipping company assigned',
        { shipmentId: shipment.id, shippingCompanyId: dto.shippingCompanyId },
        tx,
      );
      return shipment;
    });
  }

  /** Business operation: Add Tracking Number. */
  async addTrackingNumber(id: string, dto: AddTrackingNumberDto) {
    await this.findOne(id);
    return this.prisma.$transaction(async (tx) => {
      const shipment = await this.shipmentsService.addTrackingNumber(
        id,
        dto.trackingNumber,
        tx,
      );
      await this.activityService.log(
        id,
        SalesOrderActivityType.TRACKING_UPDATED,
        `Tracking number updated: ${dto.trackingNumber}`,
        { shipmentId: shipment.id, trackingNumber: dto.trackingNumber },
        tx,
      );
      return shipment;
    });
  }

  /** Business operation: Upload Shipping Label. Decision #2/#3: the label is stored on
   *  the Shipment itself (plus an attachment preserving full history), and the order
   *  enters the new LABEL_CREATED stage. */
  async uploadShippingLabel(id: string, dto: UploadShippingLabelDto) {
    const existing = await this.findOne(id);
    return this.prisma.$transaction(async (tx) => {
      const shipment = await this.shipmentsService.setLabel(
        id,
        dto.fileUrl,
        tx,
      );
      const attachment = await this.attachmentsService.create(
        id,
        {
          uploadedById: dto.uploadedById,
          fileUrl: dto.fileUrl,
          fileName: dto.fileName,
          attachmentType: 'SHIPPING_LABEL',
          description: dto.description,
          shipmentId: shipment.id,
        },
        tx,
      );
      const order = await tx.salesOrder.update({
        where: { id },
        data: { status: SalesOrderStatus.LABEL_CREATED },
      });
      await this.statusHistoryService.record(
        id,
        existing.status,
        SalesOrderStatus.LABEL_CREATED,
        tx,
      );
      await this.activityService.log(
        id,
        SalesOrderActivityType.ATTACHMENT_UPLOADED,
        'Shipping label uploaded',
        { attachmentId: attachment.id, shipmentId: shipment.id },
        tx,
      );
      await this.activityService.log(
        id,
        SalesOrderActivityType.LABEL_CREATED,
        'Label Created',
        {
          shipmentId: shipment.id,
          fromStatus: existing.status,
          toStatus: order.status,
        },
        tx,
      );
      return attachment;
    });
  }

  /** Business operation: Mark Shipped. Updates the order status and the current shipment's own status. */
  async markShipped(id: string) {
    const existing = await this.findOne(id);
    return this.prisma.$transaction(async (tx) => {
      const shipment = await this.shipmentsService.markShipped(id, tx);
      const order = await tx.salesOrder.update({
        where: { id },
        data: { status: SalesOrderStatus.SHIPPED },
      });
      await this.statusHistoryService.record(
        id,
        existing.status,
        SalesOrderStatus.SHIPPED,
        tx,
      );
      await this.activityService.log(
        id,
        SalesOrderActivityType.SHIPPED,
        'Marked Shipped',
        {
          shipmentId: shipment.id,
          fromStatus: existing.status,
          toStatus: order.status,
        },
        tx,
      );
      return order;
    });
  }

  /** Business operation: Mark Delivered. Updates the order status and the current shipment's own status. */
  async markDelivered(id: string) {
    const existing = await this.findOne(id);
    return this.prisma.$transaction(async (tx) => {
      const shipment = await this.shipmentsService.markDelivered(id, tx);
      const order = await tx.salesOrder.update({
        where: { id },
        data: { status: SalesOrderStatus.DELIVERED },
      });
      await this.statusHistoryService.record(
        id,
        existing.status,
        SalesOrderStatus.DELIVERED,
        tx,
      );
      await this.activityService.log(
        id,
        SalesOrderActivityType.DELIVERED,
        'Marked Delivered',
        {
          shipmentId: shipment.id,
          fromStatus: existing.status,
          toStatus: order.status,
        },
        tx,
      );
      return order;
    });
  }

  /** Business operation: Return Order. No status precondition — decision #3: returns
   *  are allowed before, during, and after delivery. Decision #6: the current shipment's
   *  own status is set to RETURN_BEFORE_DELIVERY or RETURN_AFTER_DELIVERY, inferred from
   *  whether that shipment had already reached DELIVERED. */
  async returnOrder(id: string) {
    const existing = await this.findOne(id);
    return this.prisma.$transaction(async (tx) => {
      const { shipment, returnStatus } =
        await this.shipmentsService.markReturned(id, tx);
      const order = await tx.salesOrder.update({
        where: { id },
        data: { status: SalesOrderStatus.RETURNED },
      });
      await this.statusHistoryService.record(
        id,
        existing.status,
        SalesOrderStatus.RETURNED,
        tx,
      );
      await this.activityService.log(
        id,
        SalesOrderActivityType.RETURNED,
        'Returned',
        {
          shipmentId: shipment.id,
          shipmentReturnStatus: returnStatus,
          fromStatus: existing.status,
        },
        tx,
      );
      return order;
    });
  }

  /** Business operation: Create Reshipment — decision #15: never a new order, a new
   *  Shipment under the same order (decision #5: unlimited, numbered attempts). Requires
   *  the order currently be RETURNED. Status goes back to READY_FOR_SHIPPING (not SHIPPED)
   *  since the new shipment needs its own label before it can be shipped again. */
  async createReshipment(id: string) {
    const existing = await this.findOne(id);
    if (existing.status !== SalesOrderStatus.RETURNED) {
      throw new BadRequestException('Only a RETURNED order can be reshipped.');
    }

    return this.prisma.$transaction(async (tx) => {
      const shipment = await this.shipmentsService.createReshipment(id, tx);
      const updated = await tx.salesOrder.update({
        where: { id },
        data: { status: SalesOrderStatus.READY_FOR_SHIPPING },
      });
      await this.statusHistoryService.record(
        id,
        existing.status,
        SalesOrderStatus.READY_FOR_SHIPPING,
        tx,
      );
      await this.activityService.log(
        id,
        SalesOrderActivityType.SHIPMENT_CREATED,
        `Shipment #${shipment.attemptNumber} created (reship)`,
        {
          shipmentId: shipment.id,
          attemptNumber: shipment.attemptNumber,
          isReship: true,
        },
        tx,
      );
      await this.activityService.log(
        id,
        SalesOrderActivityType.RESHIPPED,
        'Reshipped',
        { shipmentId: shipment.id },
        tx,
      );
      return { order: updated, shipment };
    });
  }

  /** Business operation: Add Shipping Cost — decision #11: base + additional + payer (+ notes, decision #2). */
  async addShippingCost(id: string, dto: AddShippingCostDto) {
    await this.findOne(id);
    return this.prisma.$transaction(async (tx) => {
      const shipment = await this.shipmentsService.addShippingCost(id, dto, tx);
      await this.activityService.log(
        id,
        SalesOrderActivityType.SHIPPING_COST_ADDED,
        'Shipping cost added',
        { shipmentId: shipment.id, ...dto },
        tx,
      );
      return shipment;
    });
  }

  /** Business operation: Add Internal Note. */
  async addNote(id: string, dto: CreateSalesOrderNoteDto) {
    await this.findOne(id);
    return this.prisma.$transaction(async (tx) => {
      const note = await this.notesService.create(id, dto, tx);
      await this.activityService.log(
        id,
        SalesOrderActivityType.NOTE_ADDED,
        'Note added to Sales Order',
        { noteId: note.id },
        tx,
      );
      return note;
    });
  }

  /** Business operation: Upload Attachment (generic). */
  async uploadAttachment(id: string, dto: CreateSalesOrderAttachmentDto) {
    await this.findOne(id);
    return this.prisma.$transaction(async (tx) => {
      const attachment = await this.attachmentsService.create(id, dto, tx);
      await this.activityService.log(
        id,
        SalesOrderActivityType.ATTACHMENT_UPLOADED,
        'Attachment uploaded',
        { attachmentId: attachment.id },
        tx,
      );
      return attachment;
    });
  }
}
