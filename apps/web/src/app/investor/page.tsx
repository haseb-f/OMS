import { redirect } from "next/navigation";

/** Bare `/investor` always resolves to a real screen — `proxy.ts` has already decided auth, so this only picks the destination. */
export default function InvestorPortalIndexPage() {
  redirect("/investor/dashboard");
}
