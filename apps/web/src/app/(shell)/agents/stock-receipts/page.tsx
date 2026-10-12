"use client";

import { useState } from "react";
import { useSearchParams } from "next/navigation";
import { PackagePlus } from "lucide-react";
import { PageWorkspace } from "@/components/shared/page-workspace";
import { HeaderActions } from "@/components/shared/header-actions";
import { PermissionGate } from "@/components/shared/permission-gate";
import { AgentStockReceiptsTable } from "@/components/agents/agent-stock-receipts-table";
import { AgentStockReceiptDialog } from "@/components/agents/agent-stock-receipt-dialog";
import { useLocale } from "@/providers/locale-provider";
import { useUserContext } from "@/providers/user-context";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** R18 B — custody receipts of agent-owned goods across agents (opening stock + later receipts). */
export default function AgentStockReceiptsPage() {
  return (
    <PermissionGate permission="agents.view">
      <AgentStockReceiptsPageContent />
    </PermissionGate>
  );
}

function AgentStockReceiptsPageContent() {
  const { t } = useLocale();
  const { hasPermission } = useUserContext();
  const requested = useSearchParams()?.get("receipt") ?? "";
  const receiptId = UUID.test(requested) ? requested : undefined;
  const [createOpen, setCreateOpen] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);

  return (
    <PageWorkspace
      dense
      title={t("agentStock.receipts.title")}
      description={t("agentStock.receipts.description")}
      actions={
        <HeaderActions
          primary={{
            key: "create",
            label: t("agentStock.receipts.new"),
            icon: PackagePlus,
            hidden: !hasPermission("inventory.movements.create"),
            onSelect: () => setCreateOpen(true),
          }}
        />
      }
    >
      <AgentStockReceiptsTable
        receiptId={receiptId}
        printTitle={t("agentStock.receipts.title")}
        reloadKey={reloadKey}
      />

      {createOpen ? (
        <AgentStockReceiptDialog
          onOpenChange={setCreateOpen}
          onReceived={() => setReloadKey((key) => key + 1)}
        />
      ) : null}
    </PageWorkspace>
  );
}
