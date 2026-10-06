import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { AccountMappingService } from '../../accounting/account-mapping/account-mapping.service';
import { InventoryValuationService } from '../../accounting/inventory-valuation/inventory-valuation.service';
import {
  buildInvariant,
  compareKitCogs,
  plain,
  reconcileValuation,
  summarize,
  valuationRoundingBound,
  violationFromRow,
} from './integrity-rules';
import {
  VIOLATION_CAP,
  type IntegrityFilter,
  type IntegrityReport,
  type IntegrityViolation,
  type InvariantResult,
} from './integrity.types';

/** The service's own client, or a caller's transaction (tests inspect uncommitted, rolled-back states). */
type Db = Prisma.TransactionClient | PrismaService;
type Row = Record<string, unknown>;

const RESERVATION_TYPES_SQL = Prisma.sql`('RESERVATION', 'RESERVATION_RELEASE')`;
/** Stock gains / losses that post through INVENTORY_ADJUSTMENT (R13 F11 — forward only). */
const ADJUSTMENT_TYPES_SQL = Prisma.sql`('ADJUSTMENT', 'DAMAGE', 'EXPIRED', 'PHYSICAL_COUNT')`;
/** Movement reference types whose document posts a journal with the same sourceType/sourceId. */
const DOCUMENT_REFERENCE_TYPES_SQL = Prisma.sql`('SALES_INVOICE', 'PURCHASE_INVOICE', 'SALES_RETURN', 'PURCHASE_RETURN', 'ASSEMBLY_ORDER')`;

const n = (value: unknown): number => Number(plain(value) ?? 0);
const s = (value: unknown): string => {
  const v = plain(value);
  if (v === null) return '';
  if (typeof v === 'string') return v;
  if (typeof v === 'number' || typeof v === 'boolean') return `${v}`;
  return JSON.stringify(v);
};

/** Splits `COUNT(*) OVER ()` from a capped query into rows + the findings beyond the cap. */
function capped(rows: Row[]): { rows: Row[]; uncounted: number } {
  const total = rows.length > 0 ? n(rows[0].total) : 0;
  return { rows, uncounted: Math.max(total - rows.length, 0) };
}

class Scope {
  readonly productIds: string[] | null;
  readonly warehouseId: string | null;

  constructor(filter: IntegrityFilter) {
    this.productIds =
      filter.productIds && filter.productIds.length > 0
        ? [...new Set(filter.productIds)]
        : null;
    this.warehouseId = filter.warehouseId ?? null;
  }

  get filtered(): boolean {
    return this.productIds !== null || this.warehouseId !== null;
  }

  product(column: string): Prisma.Sql {
    return this.productIds
      ? Prisma.sql`AND ${Prisma.raw(column)} = ANY(${this.productIds}::uuid[])`
      : Prisma.empty;
  }

  /** Any of the given columns in the product filter. */
  anyProduct(...columns: string[]): Prisma.Sql {
    if (!this.productIds) return Prisma.empty;
    const ids = this.productIds;
    const parts = columns.map(
      (column) => Prisma.sql`${Prisma.raw(column)} = ANY(${ids}::uuid[])`,
    );
    return Prisma.sql`AND (${Prisma.join(parts, ' OR ')})`;
  }

  warehouse(column: string): Prisma.Sql {
    return this.warehouseId
      ? Prisma.sql`AND ${Prisma.raw(column)} = ${this.warehouseId}::uuid`
      : Prisma.empty;
  }
}

/**
 * R13 Inventory integrity (spec §8, invariants I1–I7). READ-ONLY: every check
 * is a set-based SQL query over the stored rows (movements, assembly orders,
 * invoice kit snapshots, POSTED/REVERSED journal lines); nothing is written or
 * corrected. The GL side of the valuation reconciliation is the posted balance
 * read from journal lines (erp-decisions: "Reports read only from Journal
 * Entries") — never a recomputed balance. Differences are reported with their
 * known causes, never forced to zero.
 *
 * Also used by `scripts/r13/r13-integrity.ts` (outside Nest — constructed by hand).
 */
@Injectable()
export class InventoryIntegrityService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly accountMapping: AccountMappingService,
    private readonly valuation: InventoryValuationService,
  ) {}

  async run(
    filter: IntegrityFilter = {},
    client?: Prisma.TransactionClient,
  ): Promise<IntegrityReport> {
    const started = Date.now();
    const scope = new Scope(filter);
    const db: Db = client ?? this.prisma;
    const invariants: InvariantResult[] = [];
    // Sequential on purpose: one connection, a predictable load on production.
    invariants.push(await this.movementChain(db, scope));
    invariants.push(await this.nonNegative(db, scope));
    invariants.push(await this.duplicates(db, scope));
    invariants.push(await this.assemblies(db, scope));
    invariants.push(await this.kitSales(db, scope));
    invariants.push(await this.valuationVsGl(db, scope));
    invariants.push(await this.agentOwnership(db, scope));
    return {
      generatedAt: new Date().toISOString(),
      durationMs: Date.now() - started,
      filter: {
        productIds: scope.productIds,
        warehouseId: scope.warehouseId,
      },
      ...summarize(invariants),
      invariants,
    };
  }

  // ------------------------------------------------------------------ I1

  /** Per product + warehouse, ordered by createdAt (movementNumber, id tie-break): before_n = after_{n−1}, after = before + qty (reservations keep before = after). */
  private async movementChain(db: Db, scope: Scope): Promise<InvariantResult> {
    const [counts] = await db.$queryRaw<Row[]>(Prisma.sql`
      SELECT COUNT(*)::int AS movements,
             COUNT(DISTINCT (im.product_id, im.warehouse_id))::int AS chains
      FROM inventory_movements im
      WHERE TRUE ${scope.product('im.product_id')} ${scope.warehouse('im.warehouse_id')}`);
    const result = capped(
      await db.$queryRaw<Row[]>(Prisma.sql`
        WITH m AS (
          SELECT im.id, im.movement_number, im.product_id, im.warehouse_id, im.type, im.quantity,
                 im.quantity_before, im.quantity_after, im.created_at,
                 im.type IN ${RESERVATION_TYPES_SQL} AS is_reservation,
                 LAG(im.quantity_after) OVER w AS previous_after,
                 LAG(im.movement_number) OVER w AS previous_movement,
                 ROW_NUMBER() OVER w AS seq
          FROM inventory_movements im
          WHERE TRUE ${scope.product('im.product_id')} ${scope.warehouse('im.warehouse_id')}
          WINDOW w AS (
            PARTITION BY im.product_id, im.warehouse_id
            ORDER BY im.created_at, im.movement_number, im.id
          )
        ), v AS (
          SELECT m.*,
            CASE
              WHEN NOT m.is_reservation AND m.quantity_after <> m.quantity_before + m.quantity
                THEN 'AFTER_NOT_BEFORE_PLUS_QUANTITY'
              WHEN m.is_reservation AND m.quantity_after <> m.quantity_before
                THEN 'RESERVATION_CHANGED_ON_HAND'
              WHEN m.seq = 1 AND m.quantity_before <> 0 THEN 'FIRST_BEFORE_NOT_ZERO'
              WHEN m.seq > 1 AND m.quantity_before <> m.previous_after THEN 'BEFORE_NOT_PREVIOUS_AFTER'
            END AS rule
          FROM m
        )
        SELECT v.rule, v.id AS "movementId", v.movement_number AS "movementNumber", v.type::text AS type,
               v.product_id AS "productId", p.sku, v.warehouse_id AS "warehouseId", w.code AS "warehouseCode",
               v.quantity, v.quantity_before AS "quantityBefore", v.quantity_after AS "quantityAfter",
               v.previous_after AS "previousAfter", v.previous_movement AS "previousMovement",
               v.created_at AS "createdAt", COUNT(*) OVER ()::int AS total
        FROM v
        JOIN products p ON p.id = v.product_id
        JOIN warehouses w ON w.id = v.warehouse_id
        WHERE v.rule IS NOT NULL
        ORDER BY v.created_at, v.movement_number
        LIMIT ${VIOLATION_CAP}`),
    );
    const violations = result.rows.map((row) =>
      violationFromRow(
        row,
        'FAIL',
        `${s(row.movementNumber)} (${s(row.sku)} @ ${s(row.warehouseCode)}, ${s(row.type)} ${n(row.quantity)}): ` +
          `before ${n(row.quantityBefore)}, after ${n(row.quantityAfter)}` +
          (row.previousAfter === null || row.previousAfter === undefined
            ? ''
            : `, previous after ${n(row.previousAfter)} (${s(row.previousMovement)})`),
      ),
    );
    return buildInvariant({
      id: 'I1',
      title: 'Movement chain per product and warehouse',
      checked: n(counts?.movements),
      violations,
      uncounted: result.uncounted,
      metrics: {
        movements: n(counts?.movements),
        chains: n(counts?.chains),
      },
    });
  }

  // ------------------------------------------------------------------ I2

  /** No negative on-hand (now or at any movement), reserved ≥ 0 and reserved ≤ on-hand. */
  private async nonNegative(db: Db, scope: Scope): Promise<InvariantResult> {
    const [counts] = await db.$queryRaw<Row[]>(Prisma.sql`
      SELECT COUNT(DISTINCT (im.product_id, im.warehouse_id))::int AS balances
      FROM inventory_movements im
      WHERE TRUE ${scope.product('im.product_id')} ${scope.warehouse('im.warehouse_id')}`);
    const balances = n(counts?.balances);
    const result = capped(
      await db.$queryRaw<Row[]>(Prisma.sql`
      WITH b AS (
        SELECT im.product_id, im.warehouse_id,
               COALESCE(SUM(im.quantity) FILTER (WHERE im.type NOT IN ${RESERVATION_TYPES_SQL}), 0)::int AS on_hand,
               COALESCE(SUM(im.quantity) FILTER (WHERE im.type IN ${RESERVATION_TYPES_SQL}), 0)::int AS reserved,
               MIN(im.quantity_after) FILTER (WHERE im.type NOT IN ${RESERVATION_TYPES_SQL}) AS lowest_after
        FROM inventory_movements im
        WHERE TRUE ${scope.product('im.product_id')} ${scope.warehouse('im.warehouse_id')}
        GROUP BY im.product_id, im.warehouse_id
      ), v AS (
        SELECT b.*,
          CASE
            WHEN b.on_hand < 0 THEN 'NEGATIVE_ON_HAND'
            WHEN b.reserved < 0 THEN 'NEGATIVE_RESERVED'
            WHEN b.reserved > b.on_hand THEN 'RESERVED_EXCEEDS_ON_HAND'
            WHEN b.lowest_after < 0 THEN 'NEGATIVE_ON_HAND_IN_HISTORY'
          END AS rule
        FROM b
      )
      SELECT v.rule, v.product_id AS "productId", p.sku, v.warehouse_id AS "warehouseId", w.code AS "warehouseCode",
             v.on_hand AS "onHand", v.reserved, v.lowest_after AS "lowestAfter", COUNT(*) OVER ()::int AS total
      FROM v
      JOIN products p ON p.id = v.product_id
      JOIN warehouses w ON w.id = v.warehouse_id
      WHERE v.rule IS NOT NULL
      ORDER BY p.sku
      LIMIT ${VIOLATION_CAP}`),
    );
    const violations = result.rows.map((row) =>
      violationFromRow(
        row,
        'FAIL',
        `${s(row.sku)} @ ${s(row.warehouseCode)}: on-hand ${n(row.onHand)}, reserved ${n(row.reserved)}, lowest balance in history ${n(row.lowestAfter)}`,
      ),
    );
    return buildInvariant({
      id: 'I2',
      title: 'No negative stock; reserved within on-hand',
      checked: balances,
      violations,
      uncounted: result.uncounted,
      metrics: { balances },
    });
  }

  // ------------------------------------------------------------------ I3

  /** Duplicate idempotency keys (impossible — unique index) and possible duplicate legacy (un-keyed) document movements (WARN, never corrected). */
  private async duplicates(db: Db, scope: Scope): Promise<InvariantResult> {
    const [counts] = await db.$queryRaw<Row[]>(Prisma.sql`
      SELECT COUNT(*) FILTER (WHERE im.idempotency_key IS NOT NULL)::int AS keyed,
             COUNT(*) FILTER (WHERE im.idempotency_key IS NULL AND im.reference_id IS NOT NULL
                               AND im.type NOT IN ${RESERVATION_TYPES_SQL})::int AS legacy
      FROM inventory_movements im
      WHERE TRUE ${scope.product('im.product_id')} ${scope.warehouse('im.warehouse_id')}`);
    const keyRows = await db.$queryRaw<Row[]>(Prisma.sql`
      SELECT 'DUPLICATE_IDEMPOTENCY_KEY' AS rule, im.idempotency_key AS "idempotencyKey",
             COUNT(*)::int AS movements, array_agg(im.movement_number ORDER BY im.created_at) AS "movementNumbers"
      FROM inventory_movements im
      WHERE im.idempotency_key IS NOT NULL ${scope.product('im.product_id')} ${scope.warehouse('im.warehouse_id')}
      GROUP BY im.idempotency_key
      HAVING COUNT(*) > 1
      LIMIT ${VIOLATION_CAP}`);
    // Allowance: a document with N lines of the same product and quantity legitimately has N identical movements.
    const legacy = capped(
      await db.$queryRaw<Row[]>(Prisma.sql`
        WITH g AS (
          SELECT im.reference_type, im.reference_id, im.product_id, im.warehouse_id, im.type::text AS type,
                 im.quantity, COUNT(*)::int AS movements,
                 array_agg(im.movement_number ORDER BY im.created_at) AS numbers
          FROM inventory_movements im
          WHERE im.idempotency_key IS NULL AND im.reference_id IS NOT NULL
            AND im.type NOT IN ${RESERVATION_TYPES_SQL}
            ${scope.product('im.product_id')} ${scope.warehouse('im.warehouse_id')}
          GROUP BY 1, 2, 3, 4, 5, 6
          HAVING COUNT(*) > 1
        ), lines AS (
          SELECT 'SALES_INVOICE' AS reference_type, sales_invoice_id AS reference_id, product_id, quantity::numeric AS quantity, COUNT(*)::int AS lines
            FROM sales_invoice_items GROUP BY 1, 2, 3, 4
          UNION ALL
          SELECT 'PURCHASE_INVOICE', purchase_invoice_id, product_id, quantity::numeric, COUNT(*)::int
            FROM purchase_invoice_items GROUP BY 1, 2, 3, 4
          UNION ALL
          SELECT 'STORE_ORDER', store_order_id, product_id, quantity::numeric, COUNT(*)::int
            FROM store_order_items GROUP BY 1, 2, 3, 4
          UNION ALL
          SELECT 'SALES_RETURN', sales_return_id, product_id, quantity::numeric, COUNT(*)::int
            FROM sales_return_items GROUP BY 1, 2, 3, 4
          UNION ALL
          SELECT 'PURCHASE_RETURN', purchase_return_id, product_id, quantity::numeric, COUNT(*)::int
            FROM purchase_return_items GROUP BY 1, 2, 3, 4
        )
        SELECT 'POSSIBLE_DUPLICATE_LEGACY_MOVEMENT' AS rule, g.reference_type AS "referenceType",
               g.reference_id AS "referenceId", g.product_id AS "productId", p.sku, g.warehouse_id AS "warehouseId",
               g.type, g.quantity, g.movements, COALESCE(l.lines, 1) AS "documentLines",
               g.numbers AS "movementNumbers", COUNT(*) OVER ()::int AS total
        FROM g
        JOIN products p ON p.id = g.product_id
        LEFT JOIN lines l ON l.reference_type = g.reference_type AND l.reference_id = g.reference_id
                         AND l.product_id = g.product_id AND l.quantity = abs(g.quantity)::numeric
        WHERE g.movements > COALESCE(l.lines, 1)
        ORDER BY g.reference_type, g.reference_id
        LIMIT ${VIOLATION_CAP}`),
    );
    const violations: IntegrityViolation[] = [
      ...keyRows.map((row) =>
        violationFromRow(
          row,
          'FAIL',
          `Idempotency key ${s(row.idempotencyKey)} is used by ${n(row.movements)} movements.`,
        ),
      ),
      ...legacy.rows.map((row) =>
        violationFromRow(
          row,
          'WARN',
          `${s(row.referenceType)} ${s(row.referenceId)}: ${n(row.movements)} identical ${s(row.type)} movements of ${s(row.sku)} (${n(row.quantity)}) for ${n(row.documentLines)} document line(s) — historical, not corrected.`,
        ),
      ),
    ];
    return buildInvariant({
      id: 'I3',
      title: 'No duplicate document-line movements',
      checked: n(counts?.keyed) + n(counts?.legacy),
      violations,
      uncounted: legacy.uncounted,
      notes: [
        'Keyed (R13) movements are protected by a unique index; a duplicate key is a FAIL.',
        'Un-keyed legacy document movements repeated more often than the document has matching lines are listed as WARN for owner review — never auto-corrected.',
      ],
      metrics: {
        keyedMovements: n(counts?.keyed),
        legacyDocumentMovements: n(counts?.legacy),
      },
    });
  }

  // ------------------------------------------------------------------ I4

  private assemblyScope(scope: Scope): Prisma.Sql {
    const ids = scope.productIds;
    const product = ids
      ? Prisma.sql`AND (ao.product_id = ANY(${ids}::uuid[]) OR EXISTS (
          SELECT 1 FROM assembly_order_lines x
          WHERE x.assembly_order_id = ao.id AND x.component_product_id = ANY(${ids}::uuid[])))`
      : Prisma.empty;
    return Prisma.sql`SELECT ao.* FROM assembly_orders ao WHERE TRUE ${product} ${scope.warehouse('ao.warehouse_id')}`;
  }

  /** Assembly orders: cost arithmetic, recipe snapshot × runs, movements, and the company journal (balanced, = total; reversed ⇒ reversal entry). */
  private async assemblies(db: Db, scope: Scope): Promise<InvariantResult> {
    const orders = this.assemblyScope(scope);
    const [counts] = await db.$queryRaw<Row[]>(Prisma.sql`
      WITH o AS (${orders})
      SELECT COUNT(*)::int AS orders,
             COUNT(*) FILTER (WHERE o.status = 'REVERSED')::int AS reversed,
             COUNT(*) FILTER (WHERE o.owner_agent_id IS NOT NULL)::int AS "agentOwned"
      FROM o`);

    const costRows = await db.$queryRaw<Row[]>(Prisma.sql`
      WITH o AS (${orders}),
      l AS (SELECT l.* FROM assembly_order_lines l JOIN o ON o.id = l.assembly_order_id),
      agg AS (SELECT assembly_order_id, SUM(value) AS line_value FROM l GROUP BY 1),
      snap AS (
        SELECT o.id AS order_id, (e->>'componentProductId')::uuid AS component_id,
               NULLIF(e->>'stockQuantityPerRun', '')::numeric AS per_run,
               NULLIF(e->>'stockQuantity', '')::numeric AS stock_quantity,
               NULLIF(o.recipe_snapshot->>'outputQuantity', '')::numeric AS output_quantity
        FROM o CROSS JOIN LATERAL jsonb_array_elements(COALESCE(o.recipe_snapshot->'lines', '[]'::jsonb)) e
      ),
      f AS (
        SELECT 'TOTAL_COST_MISMATCH' AS rule, o.id AS order_id, NULL::uuid AS product_id,
               (COALESCE(a.line_value, 0) + o.direct_cost)::text AS expected, o.total_cost::text AS actual
        FROM o LEFT JOIN agg a ON a.assembly_order_id = o.id
        WHERE COALESCE(a.line_value, 0) + o.direct_cost <> o.total_cost
        UNION ALL
        SELECT 'COMPONENT_COST_MISMATCH', o.id, NULL, COALESCE(a.line_value, 0)::text, o.component_cost::text
        FROM o LEFT JOIN agg a ON a.assembly_order_id = o.id
        WHERE COALESCE(a.line_value, 0) <> o.component_cost
        UNION ALL
        SELECT 'UNIT_COST_MISMATCH', o.id, NULL, o.total_cost::text, (o.unit_cost * o.quantity)::text
        FROM o WHERE abs(o.unit_cost * o.quantity - o.total_cost) > GREATEST(0.01, o.quantity * 0.00005)
        UNION ALL
        SELECT 'LINE_VALUE_MISMATCH', l.assembly_order_id, l.component_product_id,
               round(l.unit_cost * l.quantity, 2)::text, l.value::text
        FROM l WHERE round(l.unit_cost * l.quantity, 2) <> l.value
        UNION ALL
        SELECT 'CONSUMPTION_NOT_SNAPSHOT_TIMES_RUNS', o.id, l.component_product_id,
               COALESCE((s.per_run * o.quantity / NULLIF(s.output_quantity, 0))::text, 'not in snapshot'),
               l.quantity::text
        FROM l JOIN o ON o.id = l.assembly_order_id
        LEFT JOIN snap s ON s.order_id = o.id AND s.component_id = l.component_product_id
        WHERE s.component_id IS NULL OR l.quantity <> s.stock_quantity
           OR l.quantity::numeric <> s.per_run * o.quantity / NULLIF(s.output_quantity, 0)
        UNION ALL
        SELECT 'SNAPSHOT_COMPONENT_NOT_CONSUMED', s.order_id, s.component_id, s.stock_quantity::text, '0'
        FROM snap s
        LEFT JOIN l ON l.assembly_order_id = s.order_id AND l.component_product_id = s.component_id
        WHERE l.id IS NULL
        UNION ALL
        SELECT 'OUTPUT_MOVEMENT_MISMATCH', o.id, o.product_id, o.quantity::text,
               COALESCE(m.type::text || ' ' || m.quantity::text, 'missing')
        FROM o LEFT JOIN inventory_movements m ON m.id = o.output_movement_id
        WHERE m.id IS NULL OR m.product_id <> o.product_id OR m.quantity <> o.quantity
           OR m.type <> 'PRODUCTION_OUTPUT' OR m.reference_id <> o.id
        UNION ALL
        SELECT 'CONSUMPTION_MOVEMENT_MISMATCH', l.assembly_order_id, l.component_product_id, (-l.quantity)::text,
               COALESCE(m.type::text || ' ' || m.quantity::text, 'missing')
        FROM l LEFT JOIN inventory_movements m ON m.id = l.consumption_movement_id
        WHERE m.id IS NULL OR m.product_id <> l.component_product_id OR m.quantity <> -l.quantity
           OR m.type <> 'PRODUCTION_CONSUMPTION' OR m.reference_id <> l.assembly_order_id
      )
      SELECT f.rule, f.order_id AS "assemblyOrderId", o.assembly_number AS "assemblyNumber",
             f.product_id AS "productId", p.sku, f.expected, f.actual
      FROM f JOIN o ON o.id = f.order_id LEFT JOIN products p ON p.id = f.product_id
      ORDER BY o.assembly_number
      LIMIT ${VIOLATION_CAP * 2}`);

    // Movements referencing each order, per product / type / direction, vs what the order implies (forward + reversal).
    const movementRows = await db.$queryRaw<Row[]>(Prisma.sql`
      WITH o AS (${orders}),
      l AS (SELECT l.* FROM assembly_order_lines l JOIN o ON o.id = l.assembly_order_id),
      expected AS (
        SELECT o.id AS order_id, o.product_id, 'PRODUCTION_OUTPUT' AS type, 1 AS direction, o.quantity::bigint AS qty FROM o
        UNION ALL
        SELECT o.id, o.product_id, 'PRODUCTION_OUTPUT', -1,
               CASE WHEN o.status = 'REVERSED' THEN -o.quantity ELSE 0 END::bigint FROM o
        UNION ALL
        SELECT l.assembly_order_id, l.component_product_id, 'PRODUCTION_CONSUMPTION', -1, (-l.quantity)::bigint FROM l
        UNION ALL
        SELECT l.assembly_order_id, l.component_product_id, 'PRODUCTION_CONSUMPTION', 1,
               CASE WHEN o.status = 'REVERSED' THEN l.quantity ELSE 0 END::bigint
        FROM l JOIN o ON o.id = l.assembly_order_id
      ),
      actual AS (
        SELECT m.reference_id AS order_id, m.product_id, m.type::text AS type, sign(m.quantity)::int AS direction,
               SUM(m.quantity)::bigint AS qty, COUNT(*)::int AS movements
        FROM inventory_movements m
        WHERE m.reference_type = 'ASSEMBLY_ORDER' AND m.reference_id IN (SELECT id FROM o)
        GROUP BY 1, 2, 3, 4
      )
      SELECT 'ASSEMBLY_MOVEMENTS_MISMATCH' AS rule, COALESCE(e.order_id, a.order_id) AS "assemblyOrderId",
             o.assembly_number AS "assemblyNumber", COALESCE(e.product_id, a.product_id) AS "productId", p.sku,
             COALESCE(e.type, a.type) AS type,
             CASE WHEN COALESCE(e.direction, a.direction) > 0 THEN 'IN' ELSE 'OUT' END AS direction,
             COALESCE(e.qty, 0) AS expected, COALESCE(a.qty, 0) AS actual, COALESCE(a.movements, 0) AS movements
      FROM expected e
      FULL JOIN actual a ON a.order_id = e.order_id AND a.product_id = e.product_id
                        AND a.type = e.type AND a.direction = e.direction
      JOIN o ON o.id = COALESCE(e.order_id, a.order_id)
      LEFT JOIN products p ON p.id = COALESCE(e.product_id, a.product_id)
      WHERE COALESCE(e.qty, 0) <> COALESCE(a.qty, 0)
      LIMIT ${VIOLATION_CAP}`);

    const journalRows = await db.$queryRaw<Row[]>(Prisma.sql`
      WITH o AS (${orders}),
      e AS (
        SELECT j.id, j.source_id, j.status::text AS status, j.reversal_of_entry_id,
               COALESCE(SUM(jl.debit), 0) AS debit, COALESCE(SUM(jl.credit), 0) AS credit
        FROM journal_entries j
        LEFT JOIN journal_entry_lines jl ON jl.journal_entry_id = j.id
        WHERE j.source_type = 'ASSEMBLY_ORDER' AND j.deleted_at IS NULL
          AND j.source_id IN (SELECT id FROM o)
        GROUP BY j.id
      ),
      per AS (
        SELECT o.id, o.assembly_number, o.status::text AS status, o.owner_agent_id, o.total_cost,
               COUNT(e.id)::int AS entries,
               COUNT(e.id) FILTER (WHERE e.reversal_of_entry_id IS NULL AND e.status = 'POSTED')::int AS active,
               COUNT(e.id) FILTER (WHERE e.reversal_of_entry_id IS NULL AND e.status = 'REVERSED')::int AS reversed_originals,
               COUNT(e.id) FILTER (WHERE e.reversal_of_entry_id IS NOT NULL)::int AS reversals,
               MAX(e.debit) FILTER (WHERE e.reversal_of_entry_id IS NULL) AS debit,
               MAX(e.credit) FILTER (WHERE e.reversal_of_entry_id IS NULL) AS credit
        FROM o LEFT JOIN e ON e.source_id = o.id
        GROUP BY o.id, o.assembly_number, o.status, o.owner_agent_id, o.total_cost
      ),
      v AS (
        SELECT per.*,
          CASE
            WHEN per.owner_agent_id IS NOT NULL AND per.entries > 0 THEN 'AGENT_ASSEMBLY_POSTED_TO_GL'
            WHEN per.owner_agent_id IS NOT NULL THEN NULL
            WHEN per.total_cost = 0 AND per.entries = 0 THEN NULL
            WHEN per.status = 'POSTED' AND per.active = 0 THEN 'JOURNAL_MISSING'
            WHEN per.status = 'POSTED' AND (per.active > 1 OR per.reversals > 0 OR per.reversed_originals > 0)
              THEN 'JOURNAL_STATE_INVALID'
            WHEN per.status = 'REVERSED' AND per.active > 0 THEN 'REVERSED_ORDER_JOURNAL_STILL_ACTIVE'
            WHEN per.status = 'REVERSED' AND per.reversed_originals = 0 THEN 'JOURNAL_MISSING'
            WHEN per.status = 'REVERSED' AND per.reversals = 0 THEN 'REVERSAL_ENTRY_MISSING'
            WHEN per.debit <> per.credit THEN 'JOURNAL_UNBALANCED'
            WHEN per.debit <> per.total_cost THEN 'JOURNAL_TOTAL_MISMATCH'
          END AS rule
        FROM per
      )
      SELECT v.rule, v.id AS "assemblyOrderId", v.assembly_number AS "assemblyNumber", v.status,
             v.total_cost AS "totalCost", v.debit AS "journalDebit", v.credit AS "journalCredit",
             v.entries, v.active, v.reversals
      FROM v WHERE v.rule IS NOT NULL
      ORDER BY v.assembly_number
      LIMIT ${VIOLATION_CAP}`);

    const violations: IntegrityViolation[] = [
      ...costRows.map((row) =>
        violationFromRow(
          row,
          'FAIL',
          `${s(row.assemblyNumber)}${row.sku ? ` / ${s(row.sku)}` : ''}: expected ${s(row.expected)}, recorded ${s(row.actual)}`,
        ),
      ),
      ...movementRows.map((row) =>
        violationFromRow(
          row,
          'FAIL',
          `${s(row.assemblyNumber)} / ${s(row.sku)} ${s(row.type)} ${s(row.direction)}: expected ${n(row.expected)}, movements total ${n(row.actual)}`,
        ),
      ),
      ...journalRows.map((row) =>
        violationFromRow(
          row,
          'FAIL',
          `${s(row.assemblyNumber)} (${s(row.status)}, total ${s(row.totalCost)}): journal Dr ${s(row.journalDebit) || '—'} / Cr ${s(row.journalCredit) || '—'}, ${n(row.entries)} entr${n(row.entries) === 1 ? 'y' : 'ies'}`,
        ),
      ),
    ];
    return buildInvariant({
      id: 'I4',
      title: 'Assembly orders: cost, consumption and journal',
      checked: n(counts?.orders),
      violations,
      metrics: {
        orders: n(counts?.orders),
        reversed: n(counts?.reversed),
        agentOwned: n(counts?.agentOwned),
      },
    });
  }

  // ------------------------------------------------------------------ I5

  private kitLineScope(scope: Scope): Prisma.Sql {
    const ids = scope.productIds;
    const product = ids
      ? Prisma.sql`AND (si.product_id = ANY(${ids}::uuid[]) OR EXISTS (
          SELECT 1 FROM jsonb_array_elements(si.fulfillment_snapshot->'components') c
          WHERE (c->>'productId')::uuid = ANY(${ids}::uuid[])))`
      : Prisma.empty;
    return Prisma.sql`si.fulfillment_snapshot IS NOT NULL ${product} ${scope.warehouse('si.warehouse_id')}`;
  }

  /**
   * Kit component movements in scope: every (invoice, kit) pair of an in-scope kit line, plus — so an orphan is
   * still found — any kit-component movement of a filtered product (as kit or component) outside those pairs.
   */
  private kitMovementScope(scope: Scope): Prisma.Sql {
    if (!scope.filtered) return Prisma.empty;
    return Prisma.sql`AND ((m.reference_id, m.parent_product_id) IN (SELECT invoice_id, kit_id FROM k)
      OR (TRUE ${scope.anyProduct('m.parent_product_id', 'm.product_id')} ${scope.warehouse('m.warehouse_id')}))`;
  }

  /** Kit invoice lines: component deliveries = snapshot qtyPerKit × qty; COGS posted once, = Σ snapshot values. */
  private async kitSales(db: Db, scope: Scope): Promise<InvariantResult> {
    const lineScope = this.kitLineScope(scope);
    const [counts] = await db.$queryRaw<Row[]>(Prisma.sql`
      SELECT COUNT(*)::int AS lines, COUNT(DISTINCT si.sales_invoice_id)::int AS invoices
      FROM sales_invoice_items si WHERE ${lineScope}`);

    const deliveryRows = await db.$queryRaw<Row[]>(Prisma.sql`
      WITH k AS (
        SELECT si.sales_invoice_id AS invoice_id, si.product_id AS kit_id, si.quantity, si.fulfillment_snapshot AS snap
        FROM sales_invoice_items si WHERE ${lineScope}
      ),
      expected AS (
        SELECT k.invoice_id, k.kit_id, (x->>'productId')::uuid AS component_id,
               -SUM((x->>'qtyPerKit')::numeric * k.quantity) AS qty
        FROM k CROSS JOIN LATERAL jsonb_array_elements(k.snap->'components') x
        GROUP BY 1, 2, 3
      ),
      actual AS (
        SELECT m.reference_id AS invoice_id, m.parent_product_id AS kit_id, m.product_id AS component_id,
               SUM(m.quantity)::numeric AS qty, COUNT(*)::int AS movements
        FROM inventory_movements m
        WHERE m.type = 'SALES_DELIVERY' AND m.reference_type = 'SALES_INVOICE' AND m.parent_product_id IS NOT NULL
          ${this.kitMovementScope(scope)}
        GROUP BY 1, 2, 3
      )
      SELECT CASE WHEN e.invoice_id IS NULL THEN 'KIT_DELIVERY_WITHOUT_SNAPSHOT'
                  ELSE 'KIT_DELIVERY_QUANTITY_MISMATCH' END AS rule,
             COALESCE(e.invoice_id, a.invoice_id) AS "invoiceId", inv.invoice_number AS "invoiceNumber",
             COALESCE(e.kit_id, a.kit_id) AS "kitProductId", kp.sku AS "kitSku",
             COALESCE(e.component_id, a.component_id) AS "componentProductId", cp.sku AS "componentSku",
             COALESCE(e.qty, 0) AS expected, COALESCE(a.qty, 0) AS actual, COALESCE(a.movements, 0) AS movements
      FROM expected e
      FULL JOIN actual a ON a.invoice_id = e.invoice_id AND a.kit_id = e.kit_id AND a.component_id = e.component_id
      LEFT JOIN sales_invoices inv ON inv.id = COALESCE(e.invoice_id, a.invoice_id)
      LEFT JOIN products kp ON kp.id = COALESCE(e.kit_id, a.kit_id)
      LEFT JOIN products cp ON cp.id = COALESCE(e.component_id, a.component_id)
      WHERE COALESCE(e.qty, 0) <> COALESCE(a.qty, 0)
      LIMIT ${VIOLATION_CAP}`);

    const invoiceRows = await db.$queryRaw<Row[]>(Prisma.sql`
      WITH inv AS (SELECT DISTINCT si.sales_invoice_id AS invoice_id FROM sales_invoice_items si WHERE ${lineScope})
      SELECT inv.invoice_id AS "invoiceId", i.invoice_number AS "invoiceNumber",
             COUNT(j.id)::int AS "activeEntries"
      FROM inv
      JOIN sales_invoices i ON i.id = inv.invoice_id
      LEFT JOIN journal_entries j ON j.source_type = 'SALES_INVOICE' AND j.source_id = inv.invoice_id
        AND j.deleted_at IS NULL AND j.status = 'POSTED' AND j.reversal_of_entry_id IS NULL
      GROUP BY inv.invoice_id, i.invoice_number`);

    const expectedRows = await db.$queryRaw<Row[]>(Prisma.sql`
      WITH inv AS (SELECT DISTINCT si.sales_invoice_id AS invoice_id FROM sales_invoice_items si WHERE ${lineScope}),
      x AS (
        SELECT si.sales_invoice_id AS invoice_id, p.category_id, TRUE AS has_kit,
               round((c->>'unitCost')::numeric * (c->>'qtyPerKit')::numeric * si.quantity, 2) AS amount
        FROM sales_invoice_items si
        JOIN inv ON inv.invoice_id = si.sales_invoice_id
        JOIN products p ON p.id = si.product_id
        CROSS JOIN LATERAL jsonb_array_elements(si.fulfillment_snapshot->'components') c
        WHERE si.fulfillment_snapshot IS NOT NULL
        UNION ALL
        SELECT si.sales_invoice_id, p.category_id, FALSE, round(COALESCE(si.unit_cost, 0) * si.quantity, 2)
        FROM sales_invoice_items si
        JOIN inv ON inv.invoice_id = si.sales_invoice_id
        JOIN products p ON p.id = si.product_id
        WHERE si.fulfillment_snapshot IS NULL AND p.is_inventory_item
      )
      SELECT x.invoice_id AS "invoiceId", i.invoice_number AS "invoiceNumber", x.category_id AS "categoryId",
             bool_or(x.has_kit) AS "hasKit", SUM(x.amount) AS amount
      FROM x JOIN sales_invoices i ON i.id = x.invoice_id
      GROUP BY x.invoice_id, i.invoice_number, x.category_id`);

    const actualRows = await db.$queryRaw<Row[]>(Prisma.sql`
      WITH inv AS (SELECT DISTINCT si.sales_invoice_id AS invoice_id FROM sales_invoice_items si WHERE ${lineScope})
      SELECT j.source_id AS "invoiceId", jl.account_id AS "accountId", SUM(jl.debit) AS debit
      FROM journal_entries j
      JOIN journal_entry_lines jl ON jl.journal_entry_id = j.id
      WHERE j.source_type = 'SALES_INVOICE' AND j.deleted_at IS NULL AND j.status = 'POSTED'
        AND j.reversal_of_entry_id IS NULL AND j.source_id IN (SELECT invoice_id FROM inv)
      GROUP BY j.source_id, jl.account_id`);

    const violations: IntegrityViolation[] = deliveryRows.map((row) =>
      violationFromRow(
        row,
        'FAIL',
        `Invoice ${s(row.invoiceNumber)}: kit ${s(row.kitSku)} component ${s(row.componentSku)} delivered ${s(row.actual)}, snapshot implies ${s(row.expected)}`,
      ),
    );
    for (const row of invoiceRows) {
      const active = n(row.activeEntries);
      if (active === 1) continue;
      violations.push({
        rule:
          active === 0
            ? 'KIT_COGS_NOT_POSTED'
            : 'KIT_COGS_POSTED_MORE_THAN_ONCE',
        severity: 'FAIL',
        message: `Invoice ${s(row.invoiceNumber)} has ${active} active journal entries (exactly one expected).`,
        invoiceId: s(row.invoiceId),
        invoiceNumber: s(row.invoiceNumber),
        activeEntries: active,
      });
    }
    const cogsAccounts = new Map<string, string | null>();
    const expected: Parameters<typeof compareKitCogs>[0]['expected'] = [];
    for (const row of expectedRows) {
      const categoryId = s(row.categoryId);
      if (!cogsAccounts.has(categoryId)) {
        cogsAccounts.set(
          categoryId,
          await this.accountMapping
            .resolveCogsAccount(categoryId, db)
            .catch(() => null),
        );
      }
      const accountId = cogsAccounts.get(categoryId) ?? null;
      if (!accountId) {
        violations.push({
          rule: 'COGS_ACCOUNT_UNRESOLVED',
          severity: 'FAIL',
          message: `Invoice ${s(row.invoiceNumber)}: no COGS account resolves for category ${categoryId}.`,
          invoiceId: s(row.invoiceId),
          categoryId,
        });
        continue;
      }
      expected.push({
        invoiceId: s(row.invoiceId),
        invoiceNumber: s(row.invoiceNumber),
        accountId,
        amount: s(row.amount),
        hasKit: row.hasKit === true,
      });
    }
    const singlyPosted = new Set(
      invoiceRows
        .filter((row) => n(row.activeEntries) === 1)
        .map((row) => s(row.invoiceId)),
    );
    violations.push(
      ...compareKitCogs({
        expected: expected.filter((row) => singlyPosted.has(row.invoiceId)),
        actual: actualRows.map((row) => ({
          invoiceId: s(row.invoiceId),
          accountId: s(row.accountId),
          debit: s(row.debit),
        })),
      }),
    );
    return buildInvariant({
      id: 'I5',
      title: 'Kit sales: component deliveries and COGS once',
      checked: n(counts?.lines),
      violations,
      metrics: {
        kitLines: n(counts?.lines),
        invoices: n(counts?.invoices),
      },
    });
  }

  // ------------------------------------------------------------------ I6

  /**
   * Company stock value (Σ onHand × moving average, company-owned only, via
   * InventoryValuationService) per inventory GL account vs that account's
   * posted balance (journal lines, POSTED + REVERSED). A difference is a WARN
   * with its known causes, never a FAIL and never forced to zero.
   */
  private async valuationVsGl(db: Db, scope: Scope): Promise<InvariantResult> {
    const stock = await this.valuation.getCompanyStockValue(db);
    const products = await db.product.findMany({
      where: { id: { in: stock.items.map((item) => item.productId) } },
      select: { id: true, categoryId: true },
    });
    const categoryOf = new Map(products.map((p) => [p.id, p.categoryId]));
    const inventoryAccount = new Map<string | null, string | null>();
    const resolve = async (categoryId: string | null) => {
      if (!inventoryAccount.has(categoryId)) {
        inventoryAccount.set(
          categoryId,
          await this.accountMapping
            .resolveInventoryAccount(categoryId, db)
            .catch(() => null),
        );
      }
      return inventoryAccount.get(categoryId) ?? null;
    };
    const subledger: { accountId: string | null; value: string }[] = [];
    for (const item of stock.items) {
      subledger.push({
        accountId: await resolve(categoryOf.get(item.productId) ?? null),
        value: item.value.toString(),
      });
    }
    // Every account an inventory posting can reach: the default plus each category override (one category per distinct override).
    await resolve(null);
    const overrides = await db.productCategory.findMany({
      where: { inventoryAccountId: { not: null } },
      distinct: ['inventoryAccountId'],
      select: { id: true },
    });
    for (const category of overrides) await resolve(category.id);
    const accountIds = [
      ...new Set(
        [...inventoryAccount.values()].filter((id): id is string => !!id),
      ),
    ];
    const glRows =
      accountIds.length === 0
        ? []
        : await db.$queryRaw<Row[]>(Prisma.sql`
            SELECT a.id, a.code, a.name,
                   COALESCE(SUM(jl.debit - jl.credit) FILTER (WHERE j.id IS NOT NULL), 0) AS balance
            FROM chart_of_accounts a
            LEFT JOIN journal_entry_lines jl ON jl.account_id = a.id
            LEFT JOIN journal_entries j ON j.id = jl.journal_entry_id
              AND j.deleted_at IS NULL AND j.status IN ('POSTED', 'REVERSED')
            WHERE a.id = ANY(${accountIds}::uuid[])
            GROUP BY a.id, a.code, a.name`);
    const reconciliation = reconcileValuation({
      subledger,
      gl: glRows.map((row) => ({
        accountId: s(row.id),
        code: row.code === null ? null : s(row.code),
        name: row.name === null ? null : s(row.name),
        balance: s(row.balance),
      })),
    });
    const bound = valuationRoundingBound(stock.items);
    const causes = await this.knownValuationCauses(db, accountIds);
    // Movements valued into the sub-ledger with no matching GL posting (opening stock beyond the opening entry,
    // unposted gains/losses, document movements whose document has no journal) — at movement cost, else current cost.
    const explained = new Prisma.Decimal(causes.openingBalanceMovementValue)
      .sub(causes.openingBalanceGlOnInventoryAccounts)
      .add(causes.unpostedAdjustmentValue)
      .add(causes.documentMovementsWithoutJournalValue);
    const unexplained = reconciliation.difference.abs().gt(bound);

    const violations: IntegrityViolation[] = reconciliation.rows
      .filter((row) => row.difference !== '0.00')
      .map((row) => ({
        rule: row.accountId
          ? 'VALUATION_GL_DIFFERENCE'
          : 'STOCK_WITHOUT_INVENTORY_ACCOUNT',
        severity: 'WARN' as const,
        message: row.accountId
          ? `${row.code ?? ''} ${row.name ?? ''}: stock value ${row.subledgerValue} vs posted balance ${row.glBalance} (difference ${row.difference}).`
          : `Stock worth ${row.subledgerValue} belongs to categories with no inventory account configured.`,
        ...row,
      }));
    const notes = [
      'GL side = posted balance of the inventory accounts read from journal lines (POSTED + REVERSED pairs net to zero) — never a recomputed balance.',
      'Sub-ledger = Σ on-hand × moving average of company-owned stock (agent-owned stock excluded), each product rounded to 2 dp.',
      'A difference is reported with its known causes for review — it is never forced to zero and never auto-corrected.',
    ];
    if (scope.filtered) {
      notes.unshift(
        'Company-wide: the GL has no product / warehouse dimension, so the product / warehouse filter does not apply to this invariant.',
      );
    }
    return buildInvariant({
      id: 'I6',
      title: 'Inventory valuation vs GL inventory accounts',
      checked: stock.items.length,
      violations,
      floor: unexplained ? 'WARN' : 'PASS',
      notes,
      metrics: {
        subledgerValue: reconciliation.subledgerTotal.toFixed(2),
        glBalance: reconciliation.glTotal.toFixed(2),
        difference: reconciliation.difference.toFixed(2),
        roundingBound: bound.toFixed(2),
        inventoryAccounts: accountIds.length,
        ...causes,
        explainedByKnownCauses: explained.toFixed(2),
        remainderAfterKnownCauses: reconciliation.difference
          .sub(explained)
          .toFixed(2),
      },
    });
  }

  /** Known contributors to a valuation ↔ GL difference, computed from the data (company-owned stock only). */
  private async knownValuationCauses(
    db: Db,
    inventoryAccountIds: string[],
  ): Promise<Record<string, string | number>> {
    const [row] = await db.$queryRaw<Row[]>(Prisma.sql`
      WITH m AS (
        SELECT im.*, COALESCE(im.unit_cost, p.current_cost, 0) AS cost, p.current_cost
        FROM inventory_movements im JOIN products p ON p.id = im.product_id
        WHERE im.owner_agent_id IS NULL
      ),
      store_order_journals AS (
        SELECT DISTINCT si.store_order_id
        FROM sales_invoices si
        JOIN journal_entries j ON j.source_type = 'SALES_INVOICE' AND j.source_id = si.id AND j.deleted_at IS NULL
        WHERE si.store_order_id IS NOT NULL
      )
      SELECT
        COUNT(*) FILTER (WHERE m.type = 'OPENING_BALANCE')::int AS opening_count,
        COALESCE(SUM(m.quantity * m.cost) FILTER (WHERE m.type = 'OPENING_BALANCE'), 0) AS opening_value,
        COUNT(*) FILTER (WHERE m.type = 'TRANSFER')::int AS transfer_count,
        COUNT(*) FILTER (WHERE m.type IN ${ADJUSTMENT_TYPES_SQL} AND NOT EXISTS (
          SELECT 1 FROM journal_entries j WHERE j.source_type = 'INVENTORY_ADJUSTMENT' AND j.source_id = m.id AND j.deleted_at IS NULL
        ))::int AS unposted_adjustment_count,
        COALESCE(SUM(m.quantity * m.cost) FILTER (WHERE m.type IN ${ADJUSTMENT_TYPES_SQL} AND NOT EXISTS (
          SELECT 1 FROM journal_entries j WHERE j.source_type = 'INVENTORY_ADJUSTMENT' AND j.source_id = m.id AND j.deleted_at IS NULL
        )), 0) AS unposted_adjustment_value,
        COUNT(*) FILTER (WHERE (m.reference_type IN ${DOCUMENT_REFERENCE_TYPES_SQL} AND NOT EXISTS (
            SELECT 1 FROM journal_entries j WHERE j.source_type = m.reference_type AND j.source_id = m.reference_id AND j.deleted_at IS NULL))
          OR (m.reference_type = 'STORE_ORDER' AND m.reference_id NOT IN (SELECT store_order_id FROM store_order_journals))
        )::int AS unposted_document_count,
        COALESCE(SUM(m.quantity * m.cost) FILTER (WHERE (m.reference_type IN ${DOCUMENT_REFERENCE_TYPES_SQL} AND NOT EXISTS (
            SELECT 1 FROM journal_entries j WHERE j.source_type = m.reference_type AND j.source_id = m.reference_id AND j.deleted_at IS NULL))
          OR (m.reference_type = 'STORE_ORDER' AND m.reference_id NOT IN (SELECT store_order_id FROM store_order_journals))
        ), 0) AS unposted_document_value
      FROM m
      WHERE m.type NOT IN ${RESERVATION_TYPES_SQL}`);
    const [noCost] = await db.$queryRaw<Row[]>(Prisma.sql`
      SELECT COUNT(*)::int AS products FROM (
        SELECT im.product_id FROM inventory_movements im JOIN products p ON p.id = im.product_id
        WHERE im.owner_agent_id IS NULL AND im.type NOT IN ${RESERVATION_TYPES_SQL}
          AND (p.current_cost IS NULL OR p.current_cost = 0)
        GROUP BY im.product_id HAVING SUM(im.quantity) <> 0
      ) x`);
    const [openingGl] =
      inventoryAccountIds.length === 0
        ? [{ amount: 0 }]
        : await db.$queryRaw<Row[]>(Prisma.sql`
            SELECT COALESCE(SUM(jl.debit - jl.credit), 0) AS amount
            FROM journal_entry_lines jl JOIN journal_entries j ON j.id = jl.journal_entry_id
            WHERE j.source_type = 'OPENING_BALANCE' AND j.deleted_at IS NULL AND j.status IN ('POSTED', 'REVERSED')
              AND jl.account_id = ANY(${inventoryAccountIds}::uuid[])`);
    const money = (value: unknown) =>
      new Prisma.Decimal(s(value) || 0).toFixed(2);
    return {
      openingBalanceMovements: n(row?.opening_count),
      openingBalanceMovementValue: money(row?.opening_value),
      openingBalanceGlOnInventoryAccounts: money(openingGl?.amount),
      transferMovementsGlNeutral: n(row?.transfer_count),
      unpostedAdjustmentMovements: n(row?.unposted_adjustment_count),
      unpostedAdjustmentValue: money(row?.unposted_adjustment_value),
      documentMovementsWithoutJournal: n(row?.unposted_document_count),
      documentMovementsWithoutJournalValue: money(row?.unposted_document_value),
      stockedProductsWithoutCost: n(noCost?.products),
    };
  }

  // ------------------------------------------------------------------ I7

  /** Agent-owned stock: movement owner = product owner; never in the company GL; never in the company valuation. */
  private async agentOwnership(db: Db, scope: Scope): Promise<InvariantResult> {
    const [counts] = await db.$queryRaw<Row[]>(Prisma.sql`
      SELECT COUNT(*)::int AS movements,
             COUNT(*) FILTER (WHERE im.owner_agent_id IS NOT NULL)::int AS agent_movements
      FROM inventory_movements im
      WHERE TRUE ${scope.product('im.product_id')} ${scope.warehouse('im.warehouse_id')}`);
    const ownerRows = capped(
      await db.$queryRaw<Row[]>(Prisma.sql`
        SELECT 'MOVEMENT_OWNER_NOT_PRODUCT_OWNER' AS rule, im.id AS "movementId",
               im.movement_number AS "movementNumber", p.sku, im.product_id AS "productId",
               im.owner_agent_id AS "movementOwnerAgentId", p.owner_agent_id AS "productOwnerAgentId",
               COUNT(*) OVER ()::int AS total
        FROM inventory_movements im JOIN products p ON p.id = im.product_id
        WHERE im.owner_agent_id IS DISTINCT FROM p.owner_agent_id
          ${scope.product('im.product_id')} ${scope.warehouse('im.warehouse_id')}
        ORDER BY im.created_at
        LIMIT ${VIOLATION_CAP}`),
    );
    const glRows = await db.$queryRaw<Row[]>(Prisma.sql`
      SELECT 'AGENT_STOCK_POSTED_TO_COMPANY_GL' AS rule, j.entry_number AS "entryNumber", j.source_type AS "sourceType",
             im.movement_number AS "movementNumber", p.sku, im.owner_agent_id AS "ownerAgentId", 'FAIL' AS severity
      FROM inventory_movements im
      JOIN products p ON p.id = im.product_id
      JOIN journal_entries j ON j.deleted_at IS NULL AND j.status IN ('POSTED', 'REVERSED') AND (
           (j.source_type = 'INVENTORY_ADJUSTMENT' AND j.source_id = im.id)
        OR (j.source_type = 'ASSEMBLY_ORDER' AND im.reference_type = 'ASSEMBLY_ORDER' AND j.source_id = im.reference_id))
      WHERE im.owner_agent_id IS NOT NULL ${scope.product('im.product_id')} ${scope.warehouse('im.warehouse_id')}
      UNION ALL
      SELECT 'AGENT_STOCK_ON_COMPANY_DOCUMENT_JOURNAL', j.entry_number, j.source_type, im.movement_number, p.sku,
             im.owner_agent_id, 'WARN'
      FROM inventory_movements im
      JOIN products p ON p.id = im.product_id
      JOIN journal_entries j ON j.deleted_at IS NULL AND j.status = 'POSTED' AND j.reversal_of_entry_id IS NULL
        AND j.source_type = im.reference_type AND j.source_id = im.reference_id
      WHERE im.owner_agent_id IS NOT NULL
        AND im.reference_type IN ('SALES_INVOICE', 'PURCHASE_INVOICE', 'SALES_RETURN', 'PURCHASE_RETURN')
        ${scope.product('im.product_id')} ${scope.warehouse('im.warehouse_id')}
      LIMIT ${VIOLATION_CAP}`);

    // Company valuation must contain no agent-owned product (company-wide figure).
    const stock = await this.valuation.getCompanyStockValue(db);
    const owned = await db.product.findMany({
      where: {
        id: { in: stock.items.map((item) => item.productId) },
        ownerAgentId: { not: null },
      },
      select: { id: true, sku: true, ownerAgentId: true },
    });
    const [agentStock] = await db.$queryRaw<Row[]>(Prisma.sql`
      SELECT COALESCE(SUM(x.on_hand), 0)::bigint AS units,
             COALESCE(SUM(round(x.on_hand * COALESCE(x.current_cost, 0), 2)), 0) AS value,
             COUNT(*)::int AS products
      FROM (
        SELECT im.product_id, SUM(im.quantity) AS on_hand, MAX(p.current_cost) AS current_cost
        FROM inventory_movements im JOIN products p ON p.id = im.product_id
        WHERE im.owner_agent_id IS NOT NULL AND im.type NOT IN ${RESERVATION_TYPES_SQL}
        GROUP BY im.product_id HAVING SUM(im.quantity) <> 0
      ) x`);

    const violations: IntegrityViolation[] = [
      ...ownerRows.rows.map((row) =>
        violationFromRow(
          row,
          'FAIL',
          `${s(row.movementNumber)} (${s(row.sku)}): movement owner ${s(row.movementOwnerAgentId) || 'company'} ≠ product owner ${s(row.productOwnerAgentId) || 'company'}.`,
        ),
      ),
      ...glRows.map((row) => {
        const { severity, ...rest } = row;
        return violationFromRow(
          rest,
          severity === 'WARN' ? 'WARN' : 'FAIL',
          `Agent-owned ${s(row.sku)} movement ${s(row.movementNumber)} is referenced by company journal ${s(row.entryNumber)} (${s(row.sourceType)}).`,
        );
      }),
      ...owned.map((product) => ({
        rule: 'AGENT_STOCK_IN_COMPANY_VALUATION',
        severity: 'FAIL' as const,
        message: `Agent-owned ${product.sku} appears in the company stock valuation.`,
        productId: product.id,
        sku: product.sku,
        ownerAgentId: product.ownerAgentId,
      })),
    ];
    return buildInvariant({
      id: 'I7',
      title: 'Agent-owned stock stays outside company books',
      checked: n(counts?.movements),
      violations,
      uncounted: ownerRows.uncounted,
      notes: [
        'Company valuation check is company-wide (the product / warehouse filter does not apply to it).',
      ],
      metrics: {
        movements: n(counts?.movements),
        agentOwnedMovements: n(counts?.agent_movements),
        agentOwnedProductsInStock: n(agentStock?.products),
        agentOwnedUnitsExcluded: n(agentStock?.units),
        agentOwnedValueExcluded: new Prisma.Decimal(
          s(agentStock?.value) || 0,
        ).toFixed(2),
      },
    });
  }
}
