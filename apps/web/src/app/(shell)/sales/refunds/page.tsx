import { redirect } from "next/navigation";

/** Customer Refunds are listed on the Customer Receipts page (Refunds tab). */
export default function CustomerRefundsIndexPage() {
  redirect("/sales/payments?view=refunds");
}
