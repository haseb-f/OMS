import { Injectable } from '@nestjs/common';

/**
 * Architecture placeholder only — no scheduling, no implementation.
 *
 * Future rule (not implemented here): distribute new leads equally between
 * active sales employees who received an assignment in the last 24 hours.
 * Manual assignment (LeadAssignmentsService.assign) is the only assignment
 * path implemented in this phase.
 */
@Injectable()
export class LeadAutoDistributionService {
  distribute(): Promise<void> {
    return Promise.resolve();
  }
}
