import { createParamDecorator, type ExecutionContext } from '@nestjs/common';
import type { Request } from 'express';

export interface CompanyContext {
  companyId: string | null;
  branchId: string | null;
}

/**
 * TASK-051 Document Context Enrichment — the ambient Company/Branch scope
 * every operational document's `create()` reads, sourced from the
 * `X-Company-Id`/`X-Branch-Id` headers the frontend already attaches to
 * every request (`api-client.ts`'s `setActiveCompanyContext`, ADR-0022).
 * Nothing enforces these headers are present — both come back `null` when
 * missing, and every document's companyId/branchId column stays nullable,
 * so an old caller (or a request from before a company is selected) never
 * breaks. Never trust this for authorization — it is a display/reporting
 * scope only, no membership check is performed here.
 */
export const CurrentCompanyContext = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): CompanyContext => {
    const request = ctx.switchToHttp().getRequest<Request>();
    const companyId = request.header('x-company-id');
    const branchId = request.header('x-branch-id');
    return {
      companyId: companyId && companyId.trim() !== '' ? companyId : null,
      branchId: branchId && branchId.trim() !== '' ? branchId : null,
    };
  },
);
