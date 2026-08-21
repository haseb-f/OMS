import { AccountType } from '@prisma/client';
import { ROOT_CODE_BY_ACCOUNT_TYPE } from './code-generation.constants';
import {
  ACCOUNT_KIND,
  MAX_ACCOUNT_LEVEL,
  parseAccountKind,
  type AccountKind,
} from './coa.constants';

export interface CoaImportFileRow {
  code: string;
  name: string;
  accountType: string;
  parentAccountCode: string;
  accountKind: string;
}

export interface CoaExistingAccount {
  code: string;
  name: string;
  accountType: string;
  parentCode: string | null;
  level: number;
}

export interface CoaGraphError {
  code: string;
  message: string;
}

const ACCOUNT_TYPES = new Set<string>(Object.values(AccountType));

function isSystemRoot(code: string, accountType: string): boolean {
  return (
    ACCOUNT_TYPES.has(accountType) &&
    code === ROOT_CODE_BY_ACCOUNT_TYPE[accountType as AccountType]
  );
}

/**
 * Full-file Chart of Accounts graph checks — cycles, extra roots, depth,
 * posting-vs-aggregation, type match, and name uniqueness per parent.
 * Apply-time FK / journal-line gates stay in the service.
 */
export function validateCoaImportGraph(
  rows: CoaImportFileRow[],
  existing: CoaExistingAccount[],
): CoaGraphError[] {
  const errors: CoaGraphError[] = [];
  const fileByCode = new Map<string, CoaImportFileRow>();
  const existingByCode = new Map(existing.map((row) => [row.code, row]));

  for (const row of rows) {
    const code = row.code.trim();
    if (!code) {
      errors.push({ code: '', message: 'Code is required.' });
      continue;
    }
    if (fileByCode.has(code)) {
      errors.push({
        code,
        message: `Duplicate Account Code "${code}" in this file.`,
      });
      continue;
    }
    fileByCode.set(code, { ...row, code });
  }

  const kindByCode = new Map<string, AccountKind>();
  const typeByCode = new Map<string, string>();
  const parentByCode = new Map<string, string | null>();
  const nameByCode = new Map<string, string>();

  for (const row of existing) {
    typeByCode.set(row.code, row.accountType);
    parentByCode.set(row.code, row.parentCode);
    nameByCode.set(row.code, row.name);
  }

  for (const row of fileByCode.values()) {
    const accountType = row.accountType.trim().toUpperCase();
    if (!ACCOUNT_TYPES.has(accountType)) {
      errors.push({
        code: row.code,
        message: `Invalid account type "${row.accountType}" — expected one of ${Object.values(AccountType).join(', ')}.`,
      });
      continue;
    }
    const kind = parseAccountKind(row.accountKind);
    if (!kind) {
      errors.push({
        code: row.code,
        message: `Account Kind is required — expected ${ACCOUNT_KIND.POSTING} or ${ACCOUNT_KIND.AGGREGATION}.`,
      });
      continue;
    }
    if (
      isSystemRoot(row.code, accountType) &&
      kind !== ACCOUNT_KIND.AGGREGATION
    ) {
      errors.push({
        code: row.code,
        message: `System root "${row.code}" must be ${ACCOUNT_KIND.AGGREGATION}.`,
      });
    }

    const parentCode = row.parentAccountCode.trim() || null;
    if (!parentCode) {
      if (!isSystemRoot(row.code, accountType)) {
        errors.push({
          code: row.code,
          message: `Parent Account Code is required unless the row is a system root (codes 1–5).`,
        });
      }
    } else if (!fileByCode.has(parentCode) && !existingByCode.has(parentCode)) {
      errors.push({
        code: row.code,
        message: `Parent Account Code "${parentCode}" is not a recognized Chart of Account — choose an existing account code instead of typing a new one.`,
      });
    }

    kindByCode.set(row.code, kind);
    typeByCode.set(row.code, accountType);
    parentByCode.set(row.code, parentCode);
    nameByCode.set(row.code, row.name.trim());
  }

  const childrenByParent = new Map<string, string[]>();
  for (const [code, parentCode] of parentByCode) {
    if (!parentCode) continue;
    const list = childrenByParent.get(parentCode) ?? [];
    list.push(code);
    childrenByParent.set(parentCode, list);
  }

  for (const [parentCode, children] of childrenByParent) {
    const parentKind = kindByCode.get(parentCode);
    if (parentKind === ACCOUNT_KIND.POSTING) {
      for (const childCode of children) {
        if (fileByCode.has(childCode)) {
          errors.push({
            code: childCode,
            message: `Parent Account Code "${parentCode}" is a POSTING account and cannot have children.`,
          });
        }
      }
    }
  }

  for (const row of fileByCode.values()) {
    const parentCode = parentByCode.get(row.code);
    if (!parentCode) continue;
    const childType = typeByCode.get(row.code);
    const parentType = typeByCode.get(parentCode);
    if (childType && parentType && childType !== parentType) {
      errors.push({
        code: row.code,
        message: `A ${childType} account cannot be created under a ${parentType} parent — an account's type must match its parent's.`,
      });
    }
  }

  for (const row of fileByCode.values()) {
    const visited = new Set<string>();
    let current: string | null = row.code;
    let depth = 0;
    let cycle = false;
    while (current) {
      if (visited.has(current)) {
        cycle = true;
        break;
      }
      visited.add(current);
      depth += 1;
      if (depth > MAX_ACCOUNT_LEVEL + 8) {
        cycle = true;
        break;
      }
      current = parentByCode.get(current) ?? null;
    }
    if (cycle) {
      errors.push({
        code: row.code,
        message: `Circular Parent Account Code reference detected at code "${row.code}".`,
      });
      continue;
    }
    if (depth > MAX_ACCOUNT_LEVEL) {
      errors.push({
        code: row.code,
        message: `Account "${row.code}" exceeds the maximum hierarchy depth of ${MAX_ACCOUNT_LEVEL}.`,
      });
    }
  }

  const namesByParent = new Map<string, Map<string, string>>();
  const parentKey = (parentCode: string | null) => parentCode ?? '__ROOT__';
  for (const [code, name] of nameByCode) {
    if (!name) continue;
    const parent = parentByCode.get(code) ?? null;
    const key = parentKey(parent);
    const bucket: Map<string, string> =
      namesByParent.get(key) ?? new Map<string, string>();
    const prior = bucket.get(name.toLowerCase());
    if (prior && prior !== code && fileByCode.has(code)) {
      errors.push({
        code,
        message: `Account name "${name}" is already used under the same parent.`,
      });
    } else if (!prior) {
      bucket.set(name.toLowerCase(), code);
    }
    namesByParent.set(key, bucket);
  }

  return errors;
}
