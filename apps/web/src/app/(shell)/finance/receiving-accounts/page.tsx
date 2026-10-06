import { redirect } from "next/navigation";

/** R13 D1 — receiving accounts are a tab of the Payment Methods area (bookmarks keep working). */
export default function FinanceReceivingAccountsPage() {
  redirect("/master-data/payment-methods?tab=receiving-accounts");
}
