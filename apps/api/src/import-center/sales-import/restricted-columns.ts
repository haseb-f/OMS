/**
 * R15 (spec §3, requirement 2.12) — columns a one-time import never reads:
 * agent identity (always the importer's token), shipping execution (company,
 * tracking, carrier cost, status), payment verification (status, verified,
 * receipt account) and money that belongs to OMS (commission, cost, margin).
 * No import field maps to them; a file that carries one is imported without
 * it and the preview says so — never silently.
 */
const RESTRICTED_COLUMNS: { pattern: RegExp; ar: string; en: string }[] = [
  {
    pattern: /^(agent|agent name|agent id|agent code|الوكيل|وكيل|اسم الوكيل)$/,
    ar: 'الوكيل يُحدَّد من حساب المستخدم فقط',
    en: 'the agent always comes from your login',
  },
  {
    pattern:
      /(shipping company|carrier|tracking|shipping status|shipment|شركة الشحن|شركة التوصيل|رقم التتبع|رقم الشحنة|حالة الشحن|تكلفة الشحن)/,
    ar: 'بيانات الشحن تُسجَّل من قسم الشحن',
    en: 'shipping details are recorded by Shipping',
  },
  {
    pattern:
      /(payment status|verified|verification|receipt account|receiving account|حالة الدفع|موثق|تم التحقق|حساب الاستلام|حساب الإيداع)/,
    ar: 'التحقق من الدفع من صلاحيات المالية',
    en: 'payment verification belongs to Finance',
  },
  {
    pattern:
      /(commission|cost|margin|profit|عمولة|العمولة|تكلفة|التكلفة|هامش|ربح)/,
    ar: 'العمولات والتكاليف والهوامش تُحسب في النظام',
    en: 'commission, cost and margin are calculated by OMS',
  },
];

/** One bilingual warning per unmapped file column OMS never imports. */
export function restrictedColumnWarnings(
  headers: string[],
  columnMapping: Record<string, string>,
): string[] {
  const mapped = new Set(
    Object.values(columnMapping).map((column) =>
      column.trim().toLocaleLowerCase('en-US'),
    ),
  );
  const warnings: string[] = [];
  for (const header of headers) {
    const key = header.trim().toLocaleLowerCase('en-US');
    if (!key || mapped.has(key)) continue;
    const rule = RESTRICTED_COLUMNS.find(({ pattern }) => pattern.test(key));
    if (!rule) continue;
    warnings.push(
      `العمود «${header.trim()}» لا يُستورد (${rule.ar}) — Column "${header.trim()}" is never imported (${rule.en}).`,
    );
  }
  return warnings;
}
