import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { messages } from "@/i18n/messages";
import { translate, type MessageKey } from "@/i18n/translate";
import { permissionActionLabel, permissionNameLabel } from "./permission-matrix";

const catalogSource = readFileSync(
  join(process.cwd(), "..", "api", "src", "permissions", "permission-catalog.ts"),
  "utf8",
);
/** Every `{ action, name }` pair the API catalog declares (agent.* actions have their own vocabulary). */
const catalogActions = [...catalogSource.matchAll(/action: '([a-z_]+)',\s*name: '([^']+)'/g)].map(
  ([, action, name]) => ({ action, name }),
);

describe("permission labels (R14 fix — no raw action names in the matrix)", () => {
  it("reads the catalog", () => {
    expect(catalogActions.length).toBeGreaterThan(100);
  });

  for (const locale of ["ar", "en"] as const) {
    it(`every catalog action has a ${locale} label`, () => {
      const t = (key: MessageKey) => translate(messages[locale], key);
      const raw = catalogActions.filter(({ action, name }) => {
        const label = permissionActionLabel(t, { action, name });
        return label === action || label.startsWith("permissions.");
      });
      expect(raw.map((a) => a.name)).toEqual([]);
    });
  }

  it("renders a stored permission name as «module — action», unknown names unchanged", () => {
    const t = (key: MessageKey) => translate(messages.ar, key);
    const catalog = [
      {
        sectionKey: null,
        sectionLabelKey: null,
        modules: [
          {
            key: "customers",
            labelKey: "permissions.modules.partners",
            actions: [{ action: "lookup_global", name: "customers.lookup_global" }],
          },
        ],
      },
    ];
    expect(permissionNameLabel(t, catalog, "customers.lookup_global")).toBe(
      `${t("permissions.modules.partners")} — ${t("permissions.actions.lookupGlobal")}`,
    );
    expect(permissionNameLabel(t, catalog, "x.unknown")).toBe("x.unknown");
  });
});
