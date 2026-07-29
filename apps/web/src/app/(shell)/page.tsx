import { LayoutDashboard } from "lucide-react";
import { EmptyState } from "@/components/shared/empty-state";

/**
 * Placeholder home route — the frontend-foundation task ("Do not start
 * business pages yet") intentionally stops here. Real dashboard widgets
 * arrive once business modules have pages to summarize.
 */
export default function DashboardPage() {
  return (
    <div className="flex flex-1 items-center justify-center rounded-lg border border-dashed">
      <EmptyState
        icon={LayoutDashboard}
        title="OMS Frontend Foundation"
        description="Business pages for each module land in the next phase — use the sidebar to see the planned navigation structure."
      />
    </div>
  );
}
