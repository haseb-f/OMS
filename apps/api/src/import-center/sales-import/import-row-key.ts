import { createHash } from 'node:crypto';
import { personNameKey } from '../../common/text/person-name';

export interface ImportRowKeyLine {
  productId: string;
  quantity: number;
  /** The line amount (quantity × unit price); null when the row carries no price (leads). */
  amount: number | null;
}

export interface ImportRowKeyInput {
  /** E.164 — the normalised phone, never the raw cell. */
  phone: string;
  name: string;
  lines: ImportRowKeyLine[];
  /** `YYYY-MM-DD`; null when the row has no date (leads). */
  orderDate?: string | null;
  externalId?: string | null;
}

/**
 * R15 (D15-17, spec §4) — the identity of one imported spreadsheet row:
 * sha256 of the normalised row (scope + E.164 phone + name key + sorted lines
 * with quantities and amounts + order date + external id). The one-time import
 * and the continuous sync compute the same hash for the same row, so a retry
 * or the other path never ingests it twice; a genuine repeat order (another
 * date, products or external id) hashes differently. Cell formatting (spaces,
 * Arabic letter forms, "0501…" vs "+9665…", line order) never changes it.
 */
export function importRowHash(scope: string, input: ImportRowKeyInput): string {
  const lines = input.lines
    .map((line) => [
      line.productId,
      line.quantity,
      line.amount === null ? null : Math.round(line.amount * 100) / 100,
    ])
    .sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
  const normalized = [
    scope,
    input.phone,
    personNameKey(input.name),
    lines,
    input.orderDate ?? null,
    input.externalId?.trim().toLocaleLowerCase('en-US') || null,
  ];
  return createHash('sha256').update(JSON.stringify(normalized)).digest('hex');
}

/** `Lead.importRowKey`. */
export function leadImportRowKey(scope: string, hash: string): string {
  return `lead-import:${scope}:${hash}`;
}

/** `StoreOrder.creationIdempotencyKey` of a company order imported from a row. */
export function companyOrderImportKey(hash: string): string {
  return `import:company:${hash}`;
}

/**
 * The client key an agent order import hands to
 * `AgentOrdersService.createAgentOrder`, which stores it namespaced as
 * `agent-order:<agentId>:import:<hash>` (see `agentOrderImportMarker`).
 */
export function agentOrderImportKey(hash: string): string {
  return `import:${hash}`;
}

/** The stored `creationIdempotencyKey` of an agent order imported from a row (`agent-order:<agent>:<key>`, Spec 1B). */
export function agentOrderImportMarker(agentId: string, hash: string): string {
  return `agent-order:${agentId}:${agentOrderImportKey(hash)}`;
}
