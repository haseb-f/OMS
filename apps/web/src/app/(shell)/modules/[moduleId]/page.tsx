"use client";

import { useParams } from "next/navigation";
import { ModuleOverviewPage } from "@/components/home/module-overview";

/**
 * Module overview (`/modules/<id>`): what a Home module tile opens. Ungated by
 * the route guard on purpose (it owns no permission of its own) — the page lists
 * only the destinations the user may open and shows a no-access state otherwise.
 */
export default function ModuleOverviewRoute() {
  const params = useParams<{ moduleId: string }>();
  return <ModuleOverviewPage moduleId={decodeURIComponent(params.moduleId ?? "")} />;
}
