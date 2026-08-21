"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

/** Shipping Methods retired — redirect to Shipping Companies. */
export default function ShippingMethodsRedirectPage() {
  const router = useRouter();
  useEffect(() => {
    router.replace("/master-data/shipping-companies");
  }, [router]);
  return null;
}
