import {
  CheckCircle2,
  FileText,
  PackageCheck,
  Pencil,
  ShieldQuestion,
  Truck,
  Wallet,
  type LucideIcon,
} from "lucide-react";
import type { NextActionKind } from "./next-action";

/** One icon per order next action - the detail header and the list Grid card share it. */
export const NEXT_ACTION_ICON: Partial<Record<NextActionKind, LucideIcon>> = {
  RESOLVE_DUPLICATE: ShieldQuestion,
  CONFIRM_CUSTOMER_TOTAL: CheckCircle2,
  SET_AMOUNTS: Pencil,
  REISSUE_LABEL: Truck,
  DECLARE_PAYMENT: Wallet,
  ASSIGN_SHIPPING: Truck,
  MARK_HANDED_OVER: PackageCheck,
  UPDATE_SHIPMENT: Truck,
  MARK_READY_FOR_PICKUP: PackageCheck,
  MARK_COLLECTED: PackageCheck,
  GENERATE_INVOICE: FileText,
};
