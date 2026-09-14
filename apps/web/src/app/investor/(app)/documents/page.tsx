"use client";

import { useCallback, useState } from "react";
import { FileText } from "lucide-react";
import {
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
} from "@/components/ui/table";
import { EnterpriseCard, EnterpriseCardContent } from "@/components/ui/card";
import { EnterpriseButton } from "@/components/ui/button";
import { formatDate } from "@/lib/date";
import { useLocale } from "@/providers/locale-provider";
import { toast } from "@/lib/toast";
import { investorPortalService, type PortalDocumentItem } from "@/services/investor-portal-service";
import { usePortalQuery } from "../_components/use-portal-query";
import { PortalPageState } from "../_components/portal-page-state";
import { PortalPager } from "../_components/portal-pager";
import type { MessageKey } from "@/i18n/translate";

export default function InvestorPortalDocumentsPage() {
  const { t } = useLocale();
  const [page, setPage] = useState(1);
  const fetchDocuments = useCallback(() => investorPortalService.documents({ page }), [page]);
  const { data, error, isLoading, reload } = usePortalQuery(fetchDocuments);

  const openDocument = async (doc: PortalDocumentItem) => {
    try {
      const blob = await investorPortalService.documentBlob(doc.attachmentId);
      const url = URL.createObjectURL(blob);
      window.open(url, "_blank", "noopener,noreferrer");
      // Revoke after the new tab has had time to load the blob.
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
    } catch {
      toast.error(t("investorPortal.documents.downloadFailed"));
    }
  };

  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-lg font-semibold text-foreground">
        {t("investorPortal.documents.title")}
      </h1>

      <PortalPageState
        isLoading={isLoading}
        error={error}
        isEmpty={data?.items.length === 0}
        emptyIcon={FileText}
        emptyTitle={t("investorPortal.documents.empty")}
        emptyDescription={t("investorPortal.documents.emptyDescription")}
        onRetry={reload}
      >
        {data && (
          <EnterpriseCard>
            <EnterpriseCardContent className="p-0">
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>{t("investorPortal.documents.fields.name")}</TableHead>
                      <TableHead>{t("investorPortal.documents.fields.type")}</TableHead>
                      <TableHead>{t("investorPortal.documents.fields.opportunity")}</TableHead>
                      <TableHead>{t("investorPortal.documents.fields.date")}</TableHead>
                      <TableHead />
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {data.items.map((doc) => (
                      <TableRow key={doc.id}>
                        <TableCell className="font-medium text-foreground">
                          {doc.fileName}
                        </TableCell>
                        <TableCell>
                          {t(`investorPortal.documents.type.${doc.documentType}` as MessageKey)}
                        </TableCell>
                        <TableCell>{doc.opportunityName}</TableCell>
                        <TableCell>{formatDate(doc.date)}</TableCell>
                        <TableCell>
                          <EnterpriseButton
                            variant="outline"
                            size="sm"
                            onClick={() => void openDocument(doc)}
                          >
                            {t("investorPortal.documents.view")}
                          </EnterpriseButton>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </EnterpriseCardContent>
          </EnterpriseCard>
        )}
        <PortalPager
          page={data?.page ?? 1}
          pageSize={data?.pageSize ?? 20}
          total={data?.total ?? 0}
          onPageChange={setPage}
        />
      </PortalPageState>
    </div>
  );
}
