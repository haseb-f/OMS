import { businessDateOf } from '../../common/time/business-date';

/**
 * R17 §2 — the charge-assessment event of an agent order is its submission:
 * the commission and shipping agreement versions in force at that instant
 * are frozen into the order's terms snapshot. Pure helpers.
 */

/**
 * The assessment an existing order was priced under (its snapshot): an
 * amendment re-assesses against these exact agreement versions, falling back
 * to the versions in force at `at` when the snapshot names none (e.g. a
 * pickup order changed to shipping).
 */
export interface AssessmentPin {
  at: Date;
  agreementId: string | null;
  shippingAgreementId: string | null;
}

/**
 * The assessment instant of a new order. Agent users always order "now";
 * internal staff may back-date an order to an earlier business day (the
 * versions in force then apply, as before R17); an order dated today is
 * assessed now, so a version saved earlier today always applies to it.
 */
export function assessmentInstant(
  isAgentUser: boolean,
  orderDate: string | undefined,
  now: Date = new Date(),
): Date {
  if (isAgentUser || !orderDate) return now;
  const dated = new Date(orderDate);
  return businessDateOf(dated) === businessDateOf(now) ? now : dated;
}
