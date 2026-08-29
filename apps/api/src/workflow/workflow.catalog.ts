import { WorkflowType } from '@prisma/client';

/**
 * Closed display-color tokens — same StatusTone vocabulary as StatusBadge /
 * ShippingStatus. Arbitrary CSS colors are rejected at the API layer.
 */
export const WORKFLOW_STATUS_COLORS = [
  'neutral',
  'info',
  'warning',
  'success',
  'destructive',
] as const;

export type WorkflowStatusColor = (typeof WORKFLOW_STATUS_COLORS)[number];

export function isWorkflowStatusColor(
  value: string,
): value is WorkflowStatusColor {
  return (WORKFLOW_STATUS_COLORS as readonly string[]).includes(value);
}

/** Runtime entity keys wired to WorkflowEngine handlers. */
export const WORKFLOW_ENTITY_TYPES = ['LEAD'] as const;
export type WorkflowEntityType = (typeof WORKFLOW_ENTITY_TYPES)[number];

export function isWorkflowEntityType(
  value: string,
): value is WorkflowEntityType {
  return (WORKFLOW_ENTITY_TYPES as readonly string[]).includes(value);
}

export const WORKFLOW_TYPE_FOR_ENTITY: Record<
  WorkflowEntityType,
  WorkflowType
> = {
  LEAD: WorkflowType.LEAD,
};

/** Seed-only catalog — runtime reads StatusDefinition from the database. */
export const INITIAL_WORKFLOW_STATUSES: Array<{
  workflowType: WorkflowType;
  code: string;
  name: string;
  nameEn?: string;
  color: WorkflowStatusColor;
  sortOrder: number;
  isSystem: boolean;
  isFinal: boolean;
  isDefault: boolean;
}> = [
  // LEAD
  {
    workflowType: WorkflowType.LEAD,
    code: 'NEW',
    name: 'جديد',
    nameEn: 'New',
    color: 'neutral',
    sortOrder: 0,
    isSystem: true,
    isFinal: false,
    isDefault: true,
  },
  {
    workflowType: WorkflowType.LEAD,
    code: 'ASSIGNED',
    name: 'مُعيَّن',
    nameEn: 'Assigned',
    color: 'info',
    sortOrder: 1,
    isSystem: true,
    isFinal: false,
    isDefault: false,
  },
  {
    workflowType: WorkflowType.LEAD,
    code: 'CONTACTED',
    name: 'تم التواصل',
    nameEn: 'Contacted',
    color: 'info',
    sortOrder: 2,
    isSystem: true,
    isFinal: false,
    isDefault: false,
  },
  {
    workflowType: WorkflowType.LEAD,
    code: 'FOLLOW_UP',
    name: 'متابعة',
    nameEn: 'Follow Up',
    color: 'warning',
    sortOrder: 3,
    isSystem: true,
    isFinal: false,
    isDefault: false,
  },
  {
    workflowType: WorkflowType.LEAD,
    code: 'QUALIFIED',
    name: 'مؤهل',
    nameEn: 'Qualified',
    color: 'success',
    sortOrder: 4,
    isSystem: true,
    isFinal: false,
    isDefault: false,
  },
  {
    workflowType: WorkflowType.LEAD,
    code: 'CONVERTED',
    name: 'تم التحويل',
    nameEn: 'Converted',
    color: 'success',
    sortOrder: 5,
    isSystem: true,
    isFinal: true,
    isDefault: false,
  },
  {
    workflowType: WorkflowType.LEAD,
    code: 'LOST',
    name: 'فقد العميل',
    nameEn: 'Lost',
    color: 'destructive',
    sortOrder: 6,
    isSystem: true,
    isFinal: true,
    isDefault: false,
  },
  {
    workflowType: WorkflowType.LEAD,
    code: 'DISQUALIFIED',
    name: 'غير مؤهل',
    nameEn: 'Disqualified',
    color: 'neutral',
    sortOrder: 7,
    isSystem: true,
    isFinal: true,
    isDefault: false,
  },
  // ORDER
  {
    workflowType: WorkflowType.ORDER,
    code: 'DRAFT',
    name: 'مسودة',
    nameEn: 'Draft',
    color: 'neutral',
    sortOrder: 0,
    isSystem: true,
    isFinal: false,
    isDefault: true,
  },
  {
    workflowType: WorkflowType.ORDER,
    code: 'CONFIRMED',
    name: 'مؤكد',
    nameEn: 'Confirmed',
    color: 'info',
    sortOrder: 1,
    isSystem: true,
    isFinal: false,
    isDefault: false,
  },
  {
    workflowType: WorkflowType.ORDER,
    code: 'CANCELLED',
    name: 'ملغي',
    nameEn: 'Cancelled',
    color: 'destructive',
    sortOrder: 2,
    isSystem: true,
    isFinal: true,
    isDefault: false,
  },
  {
    workflowType: WorkflowType.ORDER,
    code: 'COMPLETED',
    name: 'مكتمل',
    nameEn: 'Completed',
    color: 'success',
    sortOrder: 3,
    isSystem: true,
    isFinal: true,
    isDefault: false,
  },
  // PAYMENT
  {
    workflowType: WorkflowType.PAYMENT,
    code: 'UNPAID',
    name: 'غير مدفوع',
    nameEn: 'Unpaid',
    color: 'neutral',
    sortOrder: 0,
    isSystem: true,
    isFinal: false,
    isDefault: true,
  },
  {
    workflowType: WorkflowType.PAYMENT,
    code: 'PAYMENT_REPORTED',
    name: 'تم الإبلاغ عن الدفع',
    nameEn: 'Payment Reported',
    color: 'warning',
    sortOrder: 1,
    isSystem: true,
    isFinal: false,
    isDefault: false,
  },
  {
    workflowType: WorkflowType.PAYMENT,
    code: 'PARTIALLY_PAID',
    name: 'مدفوع جزئياً',
    nameEn: 'Partially Paid',
    color: 'warning',
    sortOrder: 2,
    isSystem: true,
    isFinal: false,
    isDefault: false,
  },
  {
    workflowType: WorkflowType.PAYMENT,
    code: 'PAID',
    name: 'مدفوع',
    nameEn: 'Paid',
    color: 'success',
    sortOrder: 3,
    isSystem: true,
    isFinal: true,
    isDefault: false,
  },
  {
    workflowType: WorkflowType.PAYMENT,
    code: 'PARTIALLY_REFUNDED',
    name: 'مسترد جزئياً',
    nameEn: 'Partially Refunded',
    color: 'warning',
    sortOrder: 4,
    isSystem: true,
    isFinal: false,
    isDefault: false,
  },
  {
    workflowType: WorkflowType.PAYMENT,
    code: 'REFUNDED',
    name: 'مسترد',
    nameEn: 'Refunded',
    color: 'neutral',
    sortOrder: 5,
    isSystem: true,
    isFinal: true,
    isDefault: false,
  },
  // FULFILLMENT
  {
    workflowType: WorkflowType.FULFILLMENT,
    code: 'UNFULFILLED',
    name: 'غير منفّذ',
    nameEn: 'Unfulfilled',
    color: 'neutral',
    sortOrder: 0,
    isSystem: true,
    isFinal: false,
    isDefault: true,
  },
  {
    workflowType: WorkflowType.FULFILLMENT,
    code: 'READY',
    name: 'جاهز',
    nameEn: 'Ready',
    color: 'info',
    sortOrder: 1,
    isSystem: true,
    isFinal: false,
    isDefault: false,
  },
  {
    workflowType: WorkflowType.FULFILLMENT,
    code: 'PROCESSING',
    name: 'قيد المعالجة',
    nameEn: 'Processing',
    color: 'info',
    sortOrder: 2,
    isSystem: true,
    isFinal: false,
    isDefault: false,
  },
  {
    workflowType: WorkflowType.FULFILLMENT,
    code: 'SHIPPED',
    name: 'تم الشحن',
    nameEn: 'Shipped',
    color: 'info',
    sortOrder: 3,
    isSystem: true,
    isFinal: false,
    isDefault: false,
  },
  {
    workflowType: WorkflowType.FULFILLMENT,
    code: 'DELIVERED',
    name: 'تم التسليم',
    nameEn: 'Delivered',
    color: 'success',
    sortOrder: 4,
    isSystem: true,
    isFinal: false,
    isDefault: false,
  },
  {
    workflowType: WorkflowType.FULFILLMENT,
    code: 'FAILED',
    name: 'فشل',
    nameEn: 'Failed',
    color: 'destructive',
    sortOrder: 5,
    isSystem: true,
    isFinal: false,
    isDefault: false,
  },
  {
    workflowType: WorkflowType.FULFILLMENT,
    code: 'RETURNED',
    name: 'مرتجع',
    nameEn: 'Returned',
    color: 'warning',
    sortOrder: 6,
    isSystem: true,
    isFinal: false,
    isDefault: false,
  },
  {
    workflowType: WorkflowType.FULFILLMENT,
    code: 'CANCELLED',
    name: 'ملغي',
    nameEn: 'Cancelled',
    color: 'destructive',
    sortOrder: 7,
    isSystem: true,
    isFinal: true,
    isDefault: false,
  },
  // MATCHING
  {
    workflowType: WorkflowType.MATCHING,
    code: 'UNMATCHED',
    name: 'غير مطابق',
    nameEn: 'Unmatched',
    color: 'neutral',
    sortOrder: 0,
    isSystem: true,
    isFinal: false,
    isDefault: true,
  },
  {
    workflowType: WorkflowType.MATCHING,
    code: 'CANDIDATE',
    name: 'مطابقة محتملة',
    nameEn: 'Candidate',
    color: 'warning',
    sortOrder: 1,
    isSystem: true,
    isFinal: false,
    isDefault: false,
  },
  {
    workflowType: WorkflowType.MATCHING,
    code: 'REVIEW',
    name: 'مراجعة',
    nameEn: 'Review',
    color: 'warning',
    sortOrder: 2,
    isSystem: true,
    isFinal: false,
    isDefault: false,
  },
  {
    workflowType: WorkflowType.MATCHING,
    code: 'MATCHED',
    name: 'مطابق',
    nameEn: 'Matched',
    color: 'success',
    sortOrder: 3,
    isSystem: true,
    isFinal: true,
    isDefault: false,
  },
  {
    workflowType: WorkflowType.MATCHING,
    code: 'REJECTED',
    name: 'مرفوض',
    nameEn: 'Rejected',
    color: 'destructive',
    sortOrder: 4,
    isSystem: true,
    isFinal: true,
    isDefault: false,
  },
];
