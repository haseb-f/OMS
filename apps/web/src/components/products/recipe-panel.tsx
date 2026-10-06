"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { ControlSurface } from "@/components/ui/control-surface";
import { EnterpriseBadge } from "@/components/ui/badge";
import { EnterpriseButton } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { ConfirmationDialog } from "@/components/shared/confirmation-dialog";
import { MoneyInput } from "@/components/shared/money-input";
import { SearchableSelect } from "@/components/shared/searchable-select";
import {
  CompactDetailTable,
  type CompactDetailColumn,
} from "@/components/shared/data-table/compact-detail-table";
import { ProductPicker } from "@/components/business/product-picker";
import { KitAvailabilityCard, RecipeCostEstimateCard } from "@/components/products/recipe-insights";
import { useUnits } from "@/hooks/use-reference-data";
import { useLocale } from "@/providers/locale-provider";
import { useUserContext } from "@/providers/user-context";
import { canViewInventoryCost } from "@/config/inventory/cost-visibility";
import { apiErrorMessage, reportApiError, toast } from "@/lib/toast";
import { formatNumber } from "@/lib/format-number";
import type { MessageKey } from "@/i18n/translate";
import {
  productsService,
  type ProductRow,
  type RecipeLineRow,
  type RecipeRow,
  type RecipeStatus,
} from "@/services/products-service";
import {
  copySource,
  defaultVersion,
  draftFromRecipe,
  draftIssues,
  draftToInput,
  emptyDraft,
  isDraftDirty,
  type RecipeDraft,
  type RecipeDraftIssue,
  type RecipeProductKind,
} from "@/config/products/recipe-draft";
import { recipeErrorMessage } from "@/config/products/product-errors";

/** Permission for creating, editing, activating, retiring and deleting recipes (API `products.recipes.manage`). */
export const MANAGE_RECIPES_PERMISSION = "products.recipes.manage";

const STATUS_VARIANT: Record<RecipeStatus, "success" | "warning" | "secondary"> = {
  ACTIVE: "success",
  DRAFT: "warning",
  RETIRED: "secondary",
};

const ISSUE_KEYS: Record<RecipeDraftIssue, MessageKey> = {
  NO_LINES: "products.recipe.issues.NO_LINES",
  LINE_INCOMPLETE: "products.recipe.issues.LINE_INCOMPLETE",
  DUPLICATE_COMPONENT: "products.recipe.issues.DUPLICATE_COMPONENT",
  OUTPUT_INVALID: "products.recipe.issues.OUTPUT_INVALID",
  DIRECT_COST_INVALID: "products.recipe.issues.DIRECT_COST_INVALID",
};

type Confirm = "activate" | "retire" | "delete" | null;

/**
 * Recipe of an Assembled item or a Kit (R13 §3): versions with a status, the
 * active version's lines, a DRAFT editor, and Activate / Retire / Delete-draft
 * with confirmation. Only holders of `products.recipes.manage` see edit
 * actions. Server validation codes (cycle, mixed owner, unit conversion …)
 * are shown as clear localized messages, never as a raw error. The cost
 * ESTIMATE and (for a Kit) its availability come from the API and are shown
 * only when returned.
 */
export function RecipePanel({ product }: { product: ProductRow }) {
  const { t } = useLocale();
  const { hasPermission } = useUserContext();
  const canManage = hasPermission(MANAGE_RECIPES_PERMISSION);
  // The direct-cost estimate is a cost figure (API withholds it otherwise).
  const canSeeCost =
    canViewInventoryCost(hasPermission) || hasPermission("inventory.assembly.direct_cost");
  const kind: RecipeProductKind = product.supplyMethod === "KIT" ? "KIT" : "ASSEMBLED";
  const units = useUnits();

  const [recipes, setRecipes] = useState<RecipeRow[] | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [draft, setDraft] = useState<RecipeDraft | null>(null);
  const [savedDraft, setSavedDraft] = useState<RecipeDraft | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const [confirm, setConfirm] = useState<Confirm>(null);
  const [showIssues, setShowIssues] = useState(false);

  const unitOptions = useMemo(
    () => units.map((unit) => ({ value: unit.id, label: unit.name })),
    [units],
  );

  const selected = recipes?.find((recipe) => recipe.id === selectedId) ?? null;
  const active = recipes?.find((recipe) => recipe.status === "ACTIVE") ?? null;

  /** Opens `recipe` — a DRAFT in the editor for managers, anything else read-only. */
  const open = useCallback(
    (recipe: RecipeRow | null) => {
      setSelectedId(recipe?.id ?? null);
      setShowIssues(false);
      if (recipe?.status === "DRAFT" && canManage) {
        const next = draftFromRecipe(recipe);
        setDraft(next);
        setSavedDraft(next);
      } else {
        setDraft(null);
        setSavedDraft(null);
      }
    },
    [canManage],
  );

  const load = useCallback(
    async (preferId?: string) => {
      try {
        const rows = await productsService.recipes.list(product.id);
        setRecipes(rows);
        setLoadFailed(false);
        open(rows.find((row) => row.id === preferId) ?? defaultVersion(rows));
      } catch (loadError) {
        setLoadFailed(true);
        setRecipes([]);
        reportApiError(loadError, "products.recipe.loadFailed");
      }
    },
    [open, product.id],
  );

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
    // Reload only when the product changes — `open`/`load` are stable per product + permission.
  }, [load]);

  const fail = (failure: unknown) => {
    const message =
      recipeErrorMessage(failure, t) ?? apiErrorMessage(failure, "common.failedToSave");
    setError(message);
    toast.error(message);
  };

  /** Run a server action: clears the last error, shows busy, reports a failure inline + as a toast. */
  const run = async (action: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try {
      await action();
    } catch (failure) {
      fail(failure);
    } finally {
      setBusy(false);
    }
  };

  const issues = draft ? draftIssues(draft, kind) : [];
  const dirty = !!draft && !!savedDraft && isDraftDirty(draft, savedDraft);
  const unsavedNew = !!draft && draft.id === null;

  /** Saves the draft (create on first save, replace afterwards); returns the saved version. */
  const saveDraft = async (): Promise<RecipeRow | null> => {
    if (!draft) return null;
    if (issues.length > 0) {
      setShowIssues(true);
      return null;
    }
    const body = draftToInput(draft, kind);
    const saved = draft.id
      ? await productsService.recipes.update(draft.id, body)
      : await productsService.recipes.create(product.id, body);
    return saved;
  };

  const handleSave = () =>
    run(async () => {
      const saved = await saveDraft();
      if (!saved) return;
      toast.success(
        t(unsavedNew ? "products.recipe.toasts.created" : "products.recipe.toasts.saved"),
      );
      await load(saved.id);
    });

  const handleNewVersion = () =>
    run(async () => {
      const source = copySource(recipes ?? []);
      if (!source) {
        // Nothing to copy: an empty editor; the first save creates the DRAFT.
        const fresh = emptyDraft();
        setSelectedId(null);
        setDraft(fresh);
        setSavedDraft(fresh);
        return;
      }
      const copy = draftFromRecipe(source);
      const created = await productsService.recipes.create(product.id, {
        copyFromRecipeId: source.id,
        ...draftToInput(copy, kind),
      });
      toast.success(t("products.recipe.toasts.created"));
      await load(created.id);
    });

  const handleConfirm = () =>
    run(async () => {
      const action = confirm;
      setConfirm(null);
      if (!action) return;
      if (action === "activate") {
        // Activate what the user sees: an edited (or never saved) draft is saved first.
        const target = dirty || unsavedNew ? await saveDraft() : selected;
        if (!target) return;
        await productsService.recipes.activate(target.id);
        toast.success(t("products.recipe.toasts.activated", { version: target.version }));
        await load(target.id);
      } else if (selected && action === "retire") {
        await productsService.recipes.retire(selected.id);
        toast.success(t("products.recipe.toasts.retired", { version: selected.version }));
        await load(selected.id);
      } else if (selected) {
        await productsService.recipes.remove(selected.id);
        toast.success(t("products.recipe.toasts.deleted"));
        await load();
      }
    });

  const requestActivate = () => {
    if (!draft) return;
    if (issues.length > 0) {
      setShowIssues(true);
      return;
    }
    setConfirm("activate");
  };

  const updateLine = (key: string, patch: Partial<RecipeDraft["lines"][number]>) =>
    setDraft((current) =>
      current
        ? {
            ...current,
            lines: current.lines.map((line) => (line.key === key ? { ...line, ...patch } : line)),
          }
        : current,
    );

  const removeLine = (key: string) =>
    setDraft((current) =>
      current ? { ...current, lines: current.lines.filter((line) => line.key !== key) } : current,
    );

  const addComponent = (picked: ProductRow) =>
    setDraft((current) => {
      if (!current) return current;
      if (current.lines.some((line) => line.componentProductId === picked.id)) return current;
      return {
        ...current,
        lines: [
          ...current.lines,
          {
            key: `new-${picked.id}`,
            componentProductId: picked.id,
            label: `${picked.sku} · ${picked.displayName || picked.name}`,
            quantity: "1",
            // The component's own stock unit; the manager may pick another convertible one.
            unitId: picked.unitId,
          },
        ],
      };
    });

  if (recipes === null) return <Skeleton className="h-24 w-full" />;

  const insightsKey = `${active?.id ?? "none"}:${active?.version ?? 0}`;
  const lineColumns: CompactDetailColumn<RecipeLineRow>[] = [
    {
      id: "component",
      header: t("products.recipe.columns.component"),
      cell: (line) => (
        <span className="flex flex-col">
          <span>{line.componentName}</span>
          <span dir="ltr" className="text-caption text-muted-foreground">
            {line.componentSku}
          </span>
        </span>
      ),
    },
    {
      id: "quantity",
      header: t("products.recipe.columns.quantity"),
      align: "end",
      cell: (line) => (
        <span dir="ltr" className="num">
          {formatNumber(line.quantity)}
        </span>
      ),
    },
    {
      id: "unit",
      header: t("products.recipe.columns.unit"),
      cell: (line) => line.unitName,
    },
  ];

  return (
    <ControlSurface surface="form">
      <div className="flex min-w-0 flex-col gap-3">
        <p className="text-caption text-muted-foreground">
          {t(kind === "KIT" ? "products.recipe.hintKit" : "products.recipe.hintAssembled")}
        </p>

        {error && (
          <Alert tone="destructive">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}
        {loadFailed && (
          <Alert tone="warning">
            <AlertDescription>{t("products.recipe.loadFailed")}</AlertDescription>
          </Alert>
        )}
        {!canManage && (
          <p className="text-caption text-muted-foreground">
            {t("products.recipe.permissionNote")}
          </p>
        )}

        {/* Versions + the one create action. */}
        <div className="flex flex-wrap items-center gap-2">
          {recipes.length > 0 && (
            <div className="flex min-w-0 items-center gap-2">
              <Label htmlFor={`recipe-version-${product.id}`} className="text-caption">
                {t("products.recipe.versions")}
              </Label>
              <Select
                value={selectedId ?? undefined}
                onValueChange={(id) => open(recipes.find((row) => row.id === id) ?? null)}
              >
                <SelectTrigger id={`recipe-version-${product.id}`} size="sm" className="min-w-40">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {[...recipes]
                    .sort((a, b) => b.version - a.version)
                    .map((recipe) => (
                      <SelectItem key={recipe.id} value={recipe.id}>
                        {t("products.recipe.versionLabel", { version: recipe.version })} —{" "}
                        {t(`products.recipe.status.${recipe.status}` as MessageKey)}
                      </SelectItem>
                    ))}
                </SelectContent>
              </Select>
            </div>
          )}
          {selected && (
            <EnterpriseBadge variant={STATUS_VARIANT[selected.status]}>
              {t(`products.recipe.status.${selected.status}` as MessageKey)}
            </EnterpriseBadge>
          )}
          {canManage && !unsavedNew && (
            <EnterpriseButton
              type="button"
              variant="outline"
              size="sm"
              className="ms-auto"
              disabled={busy}
              onClick={() => void handleNewVersion()}
            >
              <Plus />
              {t(
                recipes.length === 0 ? "products.recipe.createFirst" : "products.recipe.newVersion",
              )}
            </EnterpriseButton>
          )}
        </div>

        {recipes.length > 0 && !active && (
          <Alert tone="warning">
            <AlertDescription>{t("products.recipe.noActive")}</AlertDescription>
          </Alert>
        )}

        {draft ? (
          <div className="flex flex-col gap-3">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              {kind === "ASSEMBLED" ? (
                <>
                  <div className="flex flex-col gap-1">
                    <Label htmlFor="recipe-output">
                      {t("products.recipe.fields.outputQuantity")}
                    </Label>
                    <Input
                      id="recipe-output"
                      type="number"
                      dir="ltr"
                      min={1}
                      step="any"
                      value={draft.outputQuantity}
                      aria-invalid={showIssues && issues.includes("OUTPUT_INVALID")}
                      onChange={(event) =>
                        setDraft({ ...draft, outputQuantity: event.target.value })
                      }
                    />
                  </div>
                  {canSeeCost ? (
                    <div className="flex flex-col gap-1">
                      <Label htmlFor="recipe-direct">
                        {t("products.recipe.fields.directCostEstimate")}
                      </Label>
                      <MoneyInput
                        id="recipe-direct"
                        value={draft.directCostEstimate}
                        aria-invalid={showIssues && issues.includes("DIRECT_COST_INVALID")}
                        onChange={(event) =>
                          setDraft({ ...draft, directCostEstimate: event.target.value })
                        }
                      />
                      <p className="text-caption text-muted-foreground">
                        {t("products.recipe.fields.directCostHint")}
                      </p>
                    </div>
                  ) : null}
                </>
              ) : (
                <p className="text-caption text-muted-foreground sm:col-span-2">
                  {t("products.recipe.fields.outputKitFixed")}
                </p>
              )}
            </div>

            <div className="flex flex-col gap-2">
              <Label>{t("products.recipe.columns.component")}</Label>
              {draft.lines.length === 0 ? (
                <p className="text-caption text-muted-foreground">
                  {t("products.recipe.linesEmpty")}
                </p>
              ) : (
                <ul className="flex flex-col gap-2">
                  {draft.lines.map((line) => (
                    <li
                      key={line.key}
                      className="grid grid-cols-[1fr_auto] items-end gap-2 rounded-sm border border-border p-2 sm:grid-cols-[1fr_7rem_10rem_auto]"
                    >
                      <span className="col-span-full min-w-0 truncate text-body sm:col-span-1">
                        {line.label}
                      </span>
                      <Input
                        type="number"
                        dir="ltr"
                        min={0}
                        step="any"
                        inputMode="decimal"
                        aria-label={t("products.recipe.columns.quantity")}
                        value={line.quantity}
                        aria-invalid={showIssues && !(Number(line.quantity) > 0)}
                        onChange={(event) => updateLine(line.key, { quantity: event.target.value })}
                      />
                      <SearchableSelect
                        value={line.unitId}
                        onValueChange={(unitId) => updateLine(line.key, { unitId })}
                        options={unitOptions}
                        aria-label={t("products.recipe.columns.unit")}
                        placeholder={t("products.recipe.columns.unit")}
                      />
                      <EnterpriseButton
                        type="button"
                        variant="ghost"
                        size="icon-sm"
                        aria-label={t("products.recipe.removeLine")}
                        onClick={() => removeLine(line.key)}
                      >
                        <Trash2 />
                      </EnterpriseButton>
                    </li>
                  ))}
                </ul>
              )}
              <div className="flex flex-col gap-1">
                <Label htmlFor="recipe-add-component">{t("products.recipe.addComponent")}</Label>
                <ProductPicker
                  embedded
                  value={null}
                  onChange={addComponent}
                  inventoryOnly
                  allowCreate={false}
                  agentId={product.ownerAgentId ?? undefined}
                  triggerProps={{ id: "recipe-add-component" }}
                />
                <p className="text-caption text-muted-foreground">
                  {t("products.recipe.componentHint")}
                </p>
              </div>
            </div>

            {showIssues && issues.length > 0 && (
              <Alert tone="warning">
                <AlertDescription>
                  <ul className="list-disc ps-4">
                    {issues.map((issue) => (
                      <li key={issue}>{t(ISSUE_KEYS[issue])}</li>
                    ))}
                  </ul>
                </AlertDescription>
              </Alert>
            )}

            <div className="flex flex-wrap items-center gap-2">
              <p className="me-auto text-caption text-muted-foreground">
                {t("products.recipe.separateSave")}
              </p>
              {selected && (
                <EnterpriseButton
                  type="button"
                  variant="ghost"
                  size="sm"
                  disabled={busy}
                  onClick={() => setConfirm("delete")}
                >
                  <Trash2 />
                  {t("products.recipe.actions.delete")}
                </EnterpriseButton>
              )}
              <EnterpriseButton
                type="button"
                variant="outline"
                size="sm"
                disabled={busy || (!dirty && !unsavedNew)}
                onClick={() => void handleSave()}
              >
                {t("products.recipe.actions.save")}
              </EnterpriseButton>
              <EnterpriseButton
                type="button"
                variant="success"
                size="sm"
                disabled={busy}
                onClick={requestActivate}
              >
                {t("products.recipe.actions.activate")}
              </EnterpriseButton>
            </div>
          </div>
        ) : selected ? (
          <div className="flex flex-col gap-3">
            <dl className="flex flex-wrap gap-x-6 gap-y-1 text-caption text-muted-foreground">
              <div>
                {t("products.recipe.fields.outputQuantity")}:{" "}
                <span dir="ltr" className="num text-foreground">
                  {formatNumber(selected.outputQuantity)}
                </span>
              </div>
              {kind === "ASSEMBLED" && selected.directCostEstimate != null && (
                <div>
                  {t("products.recipe.fields.directCostEstimate")}:{" "}
                  <span dir="ltr" className="num text-foreground">
                    {formatNumber(selected.directCostEstimate, { minDecimals: 2 })}
                  </span>
                </div>
              )}
              {selected.notes && <div>{selected.notes}</div>}
            </dl>
            <CompactDetailTable
              stacked
              columns={lineColumns}
              rows={selected.lines}
              rowKey={(line) => line.id}
              empty={t("products.recipe.linesEmpty")}
            />
            {canManage && selected.status === "ACTIVE" && (
              <div className="flex justify-end">
                <EnterpriseButton
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={busy}
                  onClick={() => setConfirm("retire")}
                >
                  {t("products.recipe.actions.retire")}
                </EnterpriseButton>
              </div>
            )}
          </div>
        ) : (
          <p className="text-caption text-muted-foreground">{t("products.recipe.noRecipe")}</p>
        )}

        {active && (
          <>
            <RecipeCostEstimateCard
              productId={product.id}
              refreshKey={insightsKey}
              showDirectCost={kind === "ASSEMBLED"}
            />
            {kind === "KIT" && (
              <KitAvailabilityCard productId={product.id} refreshKey={insightsKey} />
            )}
          </>
        )}
      </div>

      <ConfirmationDialog
        open={!!confirm}
        onOpenChange={(next) => !next && setConfirm(null)}
        tone={confirm === "activate" ? "success" : confirm === "delete" ? "destructive" : "warning"}
        title={confirm ? t(`products.recipe.confirm.${confirm}.title` as MessageKey) : ""}
        description={
          confirm ? t(`products.recipe.confirm.${confirm}.description` as MessageKey) : undefined
        }
        confirmLabel={confirm ? t(`products.recipe.actions.${confirm}` as MessageKey) : undefined}
        onConfirm={() => void handleConfirm()}
      />
    </ControlSurface>
  );
}
