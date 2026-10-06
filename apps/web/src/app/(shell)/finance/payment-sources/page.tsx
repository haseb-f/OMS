import { redirect } from "next/navigation";

/** R13 D1 — channels are edited in the Payment Methods area (bookmarks keep working). */
export default function FinancePaymentSourcesPage() {
  redirect("/master-data/payment-methods?tab=channels");
}
