/**
 * Typed wrappers around every `/investor-portal/*` route — mirrors the
 * `*-service.ts` convention used by every other module in this app. See
 * `apps/api/src/investor-portal/investor-portal.service.ts` for the exact
 * server-side shape each of these returns (kept in lockstep here).
 */
import { investorPortalApiClient } from "./investor-portal-api-client";
import { buildQueryString } from "@/lib/query-string";

export type InvestorPortalAccountStatus = "INVITED" | "ACTIVE" | "SUSPENDED" | "DISABLED";

export type InvestmentOpportunityStatus =
  "DRAFT" | "OPEN" | "FUNDED" | "ACTIVE" | "ENDED" | "SETTLED" | "CLOSED" | "CANCELLED";

export type InvestorLedgerEntryType =
  | "CAPITAL_FUNDED"
  | "PROFIT_ENTITLEMENT"
  | "PROFIT_PAYMENT"
  | "CAPITAL_RETURN"
  | "ADJUSTMENT"
  | "REVERSAL";

export interface PortalMe {
  id: string;
  name: string;
  phone: string | null;
  email: string | null;
  investorType: { name: string; nameEn: string | null } | null;
  nationalId: string | null;
  residencyId: string | null;
  iban: string | null;
  portalAccount: {
    email: string;
    status: InvestorPortalAccountStatus;
    lastLoginAt: string | null;
  } | null;
}

export interface PortalLedgerSummary {
  totalConfirmedCapital: number;
  capitalReturned: number;
  remainingCapitalPosition: number;
  totalApprovedProfit: number;
  totalProfitPaid: number;
  outstandingProfit: number;
  activeOpportunities: number;
  completedOpportunities: number;
}

export interface PortalRecentInvestment {
  subscriptionId: string;
  opportunityId: string;
  opportunityCode: string;
  opportunityName: string;
  opportunityNameEn: string | null;
  status: InvestmentOpportunityStatus;
  startDate: string | null;
  endDate: string | null;
  confirmedFunding: number;
  participationPercent: number;
  approvedProfit: number;
  paidProfit: number;
  outstandingProfit: number;
}

export interface PortalDashboard extends PortalLedgerSummary {
  recentInvestments: PortalRecentInvestment[];
}

export interface PortalInvestmentListItem extends PortalRecentInvestment {
  committedAmount: number;
}

export interface PortalPage<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
}

export interface PortalInvestmentDetail {
  subscriptionId: string;
  opportunity: {
    id: string;
    code: string;
    nameAr: string;
    nameEn: string | null;
    status: InvestmentOpportunityStatus;
    startDate: string | null;
    endDate: string | null;
  };
  myFunding: {
    committedAmount: number;
    confirmedFunding: number;
    participationPercent: number;
    contributions: Array<{
      id: string;
      amount: number;
      contributionDate: string;
      referenceNumber: string | null;
      status: string;
    }>;
  };
  performance: {
    fundedUnits: number;
    soldUnits: number;
    remainingUnits: number;
    sellThroughPercent: number;
  };
  myProfit: Array<{
    id: string;
    distributionCode: string;
    entitledAmount: number;
    paidAmount: number;
    outstandingAmount: number;
    status: string;
  }>;
  payments: Array<{
    id: string;
    amount: number;
    paymentDate: string;
    referenceNumber: string | null;
    status: string;
  }>;
}

export interface PortalProfitItem {
  id: string;
  opportunityId: string;
  opportunityCode: string;
  opportunityName: string;
  distributionCode: string;
  entitledAmount: number;
  paidAmount: number;
  outstandingAmount: number;
  status: string;
  lastPaymentDate: string | null;
}

export interface PortalStatementEntry {
  id: string;
  investorId: string;
  opportunityId: string | null;
  entryDate: string;
  type: InvestorLedgerEntryType;
  description: string;
  referenceType: string;
  referenceId: string;
  debitAmount: number;
  creditAmount: number;
  createdAt: string;
}

export interface PortalStatement extends PortalPage<PortalStatementEntry> {
  summary: PortalLedgerSummary;
}

export interface PortalDocumentItem {
  id: string;
  attachmentId: string;
  fileName: string;
  mimeType: string;
  documentType: "FUNDING_RECEIPT" | "DISTRIBUTION_RECEIPT";
  opportunityId: string;
  opportunityCode: string;
  opportunityName: string;
  date: string;
}

export interface PortalPageQuery {
  page?: number;
  pageSize?: number;
  opportunityId?: string;
}

export interface PortalStatementQuery extends PortalPageQuery {
  type?: InvestorLedgerEntryType[];
  dateFrom?: string;
  dateTo?: string;
}

export const investorPortalAuthService = {
  login: (email: string, password: string) =>
    investorPortalApiClient.post<{ accessToken: string }>("/investor-portal/auth/login", {
      email,
      password,
    }),
  activate: (token: string, newPassword: string) =>
    investorPortalApiClient.post<{ message: string }>("/investor-portal/auth/activate", {
      token,
      newPassword,
    }),
  forgotPassword: (email: string) =>
    investorPortalApiClient.post<{ message: string }>("/investor-portal/auth/forgot-password", {
      email,
    }),
};

export const investorPortalService = {
  me: () => investorPortalApiClient.get<PortalMe>("/investor-portal/me"),
  dashboard: () => investorPortalApiClient.get<PortalDashboard>("/investor-portal/dashboard"),
  investments: (query: PortalPageQuery = {}) =>
    investorPortalApiClient.get<PortalPage<PortalInvestmentListItem>>(
      `/investor-portal/investments${buildQueryString(query as Record<string, unknown>)}`,
    ),
  investmentDetail: (subscriptionId: string) =>
    investorPortalApiClient.get<PortalInvestmentDetail>(
      `/investor-portal/investments/${subscriptionId}`,
    ),
  profits: (query: PortalPageQuery = {}) =>
    investorPortalApiClient.get<PortalPage<PortalProfitItem>>(
      `/investor-portal/profits${buildQueryString(query as Record<string, unknown>)}`,
    ),
  statement: (query: PortalStatementQuery = {}) =>
    investorPortalApiClient.get<PortalStatement>(
      `/investor-portal/statement${buildQueryString(query as Record<string, unknown>)}`,
    ),
  documents: (query: PortalPageQuery = {}) =>
    investorPortalApiClient.get<PortalPage<PortalDocumentItem>>(
      `/investor-portal/documents${buildQueryString(query as Record<string, unknown>)}`,
    ),
  documentBlob: (attachmentId: string) =>
    investorPortalApiClient.getBlob(`/investor-portal/documents/${attachmentId}/file`),
};
