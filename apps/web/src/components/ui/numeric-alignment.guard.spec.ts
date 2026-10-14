import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";

/**
 * R22 §5 guard — numeric cells keep their header's edge in RTL.
 *
 * The `num` utility (theme/tokens.css) sets `direction: ltr` so figures never
 * reorder inside Arabic text. `text-end` on that SAME element then resolves to
 * the right edge, while its header's `text-end` resolves to the left one in
 * Arabic — measured in the voucher open-invoices table (headers on the left,
 * figures on the right, 88-145 px apart). The shared pattern is: the cell
 * carries `text-end` (`TableCell numeric`, `tableNumericCellClass`) and the
 * figure sits in an inner `num` run. This guard fails on any element class
 * list that combines `num` with `text-end`, and on a raw cell / block that
 * pairs `dir="ltr"` with `text-end`.
 */
const SRC = resolve(__dirname, "../..");

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return name === "node_modules" ? [] : sourceFiles(path);
    return /\.tsx$/.test(name) && !/\.spec\.tsx$/.test(name) ? [path] : [];
  });
}

const files = sourceFiles(SRC);

describe("numeric alignment guard (R22 §5)", () => {
  it("scans the web sources", () => {
    expect(files.length).toBeGreaterThan(100);
  });

  it("no class list combines the LTR `num` run with `text-end` on the same element", () => {
    const offenders: string[] = [];
    for (const file of files) {
      const text = readFileSync(file, "utf8");
      for (const match of text.matchAll(/["'`]([^"'`\n]*)["'`]/g)) {
        const tokens = new Set(match[1].split(/\s+/));
        if (tokens.has("num") && tokens.has("text-end")) {
          const line = text.slice(0, match.index).split("\n").length;
          offenders.push(`${relative(SRC, file)}:${line} «${match[1].trim()}»`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  it('no raw cell or block pairs dir="ltr" with text-end (TableCell isolates its content itself)', () => {
    const offenders: string[] = [];
    for (const file of files) {
      const text = readFileSync(file, "utf8");
      for (const match of text.matchAll(/<(td|th|dd|div|p)\b[^>]*>/g)) {
        const tag = match[0];
        if (/dir="ltr"/.test(tag) && /\btext-end\b/.test(tag)) {
          const line = text.slice(0, match.index).split("\n").length;
          offenders.push(`${relative(SRC, file)}:${line}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });
});
