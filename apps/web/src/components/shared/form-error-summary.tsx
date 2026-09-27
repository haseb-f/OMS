"use client";

/**
 * FormErrorSummary — the persistent "why didn't this save?" banner at the top
 * of a form (design-system §11.4). Toasts only supplement it.
 *
 * USAGE (any react-hook-form form; the MasterDataPage dialog is the reference
 * integration — components/master-data/master-data-page.tsx):
 *
 *   const bodyRef = useRef<HTMLDivElement>(null);
 *   const focusFirstInvalid = useFocusFirstInvalid(bodyRef);
 *   const [submitAttempted, setSubmitAttempted] = useState(false);
 *   const [serverErrors, setServerErrors] = useState<FormErrorItem[]>([]);
 *
 *   const errors = submitAttempted
 *     ? [...formErrorsFromRhf(form.formState.errors, { labelFor, order }), ...serverErrors]
 *     : [];
 *
 *   const submit = () => {
 *     setSubmitAttempted(true);
 *     setServerErrors([]);
 *     return form.handleSubmit(async (values) => {
 *       try {
 *         const saved = await service.save(values);
 *         setSubmitAttempted(false);
 *         reportSuccess(t("common.saved"), { href: recordHref(saved) }); // + update header/status in place
 *       } catch (error) {
 *         setServerErrors(applyServerFieldErrors(error, form.setError, { knownFields, labelFor }));
 *         focusFirstInvalid();
 *       }
 *     }, () => focusFirstInvalid())();
 *   };
 *
 *   <EnterpriseModal errorSummary={<FormErrorSummary errors={errors} />} …>
 *     <div ref={bodyRef}>…fields…</div>
 *   </EnterpriseModal>
 *
 * Document editors (not in a modal) render <FormErrorSummary> directly above
 * the editor body. Rules:
 *  - Field errors stay beside the field (`FormMessage` / `FieldMessage`).
 *  - The summary is recomputed from live form state, so it disappears as the
 *    user fixes each field, and is cleared on a successful save.
 *  - Focus moves ONCE to the first invalid field after a failed submit (via
 *    `useFocusFirstInvalid`); the banner itself never steals focus — it
 *    announces through a polite live region.
 *  - Give fields a `data-field-name="<name>"` wrapper (and `data-invalid`)
 *    when the control can't carry `aria-invalid` itself, so `fieldId` links
 *    and first-invalid focus can still reach it.
 */

import { useCallback, useEffect, useId, useRef, useState, type RefObject } from "react";
import { CircleAlert } from "lucide-react";
import type { FieldErrors, FieldValues, Path, UseFormSetError } from "react-hook-form";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { ApiError, currentLocale } from "@/services/api-client";
import { apiErrorMessage } from "@/lib/toast";
import { messages } from "@/i18n/messages";
import { translate } from "@/i18n/translate";
import { useLocale } from "@/providers/locale-provider";
import { cn } from "@/lib/utils";

export interface FormErrorItem {
  /** Element id, or a field name matched against `[data-field-name]` / `[name]`. Omit for a form-level problem. */
  fieldId?: string;
  /** The field's visible label — shown before the message so the item reads on its own. */
  label?: string;
  message: string;
}

const FOCUSABLE =
  'input:not([type="hidden"]):not([disabled]), select:not([disabled]), textarea:not([disabled]), button:not([disabled]), [tabindex]:not([tabindex="-1"]), [contenteditable="true"]';

/** Escapes a value for use inside a double-quoted attribute selector. */
function attr(value: string) {
  return value.replace(/["\\]/g, "\\$&");
}

/** Resolves a summary item's `fieldId` to the focusable control it names, within `root`. */
export function findFieldElement(target: string, root: ParentNode = document): HTMLElement | null {
  const byId = root.querySelector<HTMLElement>(`[id="${attr(target)}"]`);
  if (byId)
    return byId.matches(FOCUSABLE) ? byId : (byId.querySelector<HTMLElement>(FOCUSABLE) ?? byId);
  const wrapper = root.querySelector<HTMLElement>(`[data-field-name="${attr(target)}"]`);
  if (wrapper) {
    return (
      wrapper.querySelector<HTMLElement>('[aria-invalid="true"]') ??
      wrapper.querySelector<HTMLElement>(FOCUSABLE)
    );
  }
  return root.querySelector<HTMLElement>(`[name="${attr(target)}"]`);
}

/** Focuses a control and brings it into view (the modal body is the scroller). */
export function focusElement(element: HTMLElement) {
  element.focus({ preventScroll: true });
  element.scrollIntoView?.({ block: "center", inline: "nearest" });
}

/** Focuses the first invalid control (DOM order) inside `root`. Returns whether one was found. */
export function focusFirstInvalidIn(root: ParentNode | null | undefined): boolean {
  if (!root) return false;
  const first = root.querySelector<HTMLElement>('[aria-invalid="true"], [data-invalid="true"]');
  if (!first) return false;
  const target =
    first.getAttribute("aria-invalid") === "true" && first.matches(FOCUSABLE)
      ? first
      : (first.querySelector<HTMLElement>('[aria-invalid="true"]') ??
        first.querySelector<HTMLElement>(FOCUSABLE) ??
        first);
  focusElement(target);
  return true;
}

/**
 * Returns `focusFirstInvalid()` — call it once after a failed submit. It waits
 * one frame so freshly-set `aria-invalid` attributes are in the DOM first.
 */
export function useFocusFirstInvalid(containerRef: RefObject<HTMLElement | null>) {
  return useCallback(() => {
    if (typeof window === "undefined" || typeof window.requestAnimationFrame !== "function") {
      focusFirstInvalidIn(containerRef.current);
      return;
    }
    // Errors set after an awaited request commit on a later scheduler task,
    // so keep trying for a few frames until an invalid control exists.
    let attempts = 0;
    const tick = () => {
      if (focusFirstInvalidIn(containerRef.current) || ++attempts >= 10) return;
      window.requestAnimationFrame(tick);
    };
    window.requestAnimationFrame(tick);
  }, [containerRef]);
}

/**
 * Flattens react-hook-form `errors` into summary items. `order` (field names)
 * keeps the summary in the same order as the form; unknown names keep RHF order.
 */
export function formErrorsFromRhf<T extends FieldValues>(
  errors: FieldErrors<T>,
  options: { labelFor?: (name: string) => string | undefined; order?: string[] } = {},
): FormErrorItem[] {
  const items: FormErrorItem[] = [];
  const walk = (node: unknown, path: string) => {
    if (!node || typeof node !== "object") return;
    const record = node as Record<string, unknown>;
    if (typeof record.message === "string" && record.message) {
      items.push({
        fieldId: path,
        label: options.labelFor?.(path) ?? options.labelFor?.(path.split(".")[0]),
        message: record.message,
      });
      return;
    }
    for (const [key, child] of Object.entries(record)) {
      if (key === "ref" || key === "type" || key === "types" || key === "root") continue;
      walk(child, path ? `${path}.${key}` : key);
    }
  };
  walk(errors, "");
  const order = options.order;
  if (order?.length) {
    const rank = (id?: string) => {
      const index = order.indexOf(id?.split(".")[0] ?? "");
      return index === -1 ? Number.MAX_SAFE_INTEGER : index;
    };
    items.sort((a, b) => rank(a.fieldId) - rank(b.fieldId));
  }
  return items;
}

function serverFieldMessage(constraints: string[]) {
  const dict = messages[currentLocale()];
  if (constraints.includes("unique")) return translate(dict, "feedback.server.duplicate");
  const isRequired = constraints.some(
    (c) => c === "required_for_activation" || /should not be empty|must be defined/i.test(c),
  );
  return translate(dict, isRequired ? "feedback.server.required" : "feedback.server.invalid");
}

/**
 * Maps an API failure onto the form: every `ApiError.fields` entry that names
 * a known field becomes an inline error via `setError` (it clears as soon as
 * the user edits that field). Returns the form-level items that could NOT be
 * attached to a field — render them in the summary.
 */
export function applyServerFieldErrors<T extends FieldValues>(
  error: unknown,
  setError: UseFormSetError<T>,
  options: {
    knownFields: string[];
    labelFor?: (name: string) => string | undefined;
    fallback?: Parameters<typeof apiErrorMessage>[1];
  },
): FormErrorItem[] {
  const formLevel: FormErrorItem[] = [];
  let mapped = 0;
  let unmapped = false;
  if (error instanceof ApiError && error.fields?.length) {
    // One field: the ApiError message is already field-specific (or the
    // server's own authored guidance) — keep it. Several fields: a short
    // per-field message so each inline error reads on its own.
    const single = error.fields.length === 1 && error.message.trim() ? error.message : null;
    for (const detail of error.fields) {
      const name = options.knownFields.includes(detail.field)
        ? detail.field
        : options.knownFields.find((known) => detail.field.split(".")[0] === known);
      if (!name) {
        unmapped = true;
        continue;
      }
      setError(
        name as Path<T>,
        { type: "server", message: single ?? serverFieldMessage(detail.constraints) },
        { shouldFocus: false },
      );
      mapped += 1;
    }
  }
  if (mapped === 0 || unmapped) {
    formLevel.push({ message: apiErrorMessage(error, options.fallback ?? "errors.saveFailed") });
  }
  return formLevel;
}

export function FormErrorSummary({
  errors,
  title,
  onFocusField,
  className,
}: {
  errors: FormErrorItem[];
  /** Defaults to "Not saved — N field(s) need attention". */
  title?: string;
  /** Override how an item focuses its field (default: find it inside the nearest dialog/form). */
  onFocusField?: (fieldId: string) => void;
  className?: string;
}) {
  const { t } = useLocale();
  const titleId = useId();
  const rootRef = useRef<HTMLDivElement>(null);
  const [announcement, setAnnouncement] = useState("");
  const count = errors.length;
  const visible = count > 0;
  const wasVisible = useRef(false);
  const lastCount = useRef(0);

  // Polite, concise announcements: once when the banner appears or its count
  // changes — never the whole list on every keystroke, never a focus change.
  useEffect(() => {
    if (visible && count !== lastCount.current) {
      setAnnouncement(t("feedback.formErrors.announce", { count }));
    } else if (!visible && wasVisible.current) {
      // Cleared silently: the banner also hides after a successful save,
      // where "all fixed, you can save" would be wrong.
      setAnnouncement("");
    }
    if (visible && !wasVisible.current && errors.every((item) => !item.fieldId)) {
      // Only form-level problems: no field will take focus, so bring the banner into view.
      rootRef.current?.scrollIntoView?.({ block: "nearest" });
    }
    wasVisible.current = visible;
    lastCount.current = visible ? count : 0;
  }, [visible, count, errors, t]);

  const focusField = (fieldId: string) => {
    if (onFocusField) {
      onFocusField(fieldId);
      return;
    }
    const scope =
      rootRef.current?.closest<HTMLElement>('form, [role="dialog"], [data-form-scope]') ?? document;
    const element = findFieldElement(fieldId, scope);
    if (element) focusElement(element);
  };

  return (
    <div ref={rootRef} data-slot="form-error-summary" className={cn(!visible && "contents")}>
      <p className="sr-only" aria-live="polite" aria-atomic="true">
        {announcement}
      </p>
      {visible && (
        <Alert
          tone="destructive"
          role={undefined}
          aria-labelledby={titleId}
          className={cn("mb-3", className)}
        >
          <CircleAlert aria-hidden="true" />
          <AlertDescription className="flex flex-col gap-1">
            <AlertTitle id={titleId}>
              {title ??
                (errors.some((item) => item.fieldId)
                  ? t("feedback.formErrors.title", { count })
                  : t("feedback.formErrors.formLevel"))}
            </AlertTitle>
            {errors.some((item) => item.fieldId) && (
              <p className="text-current/85">{t("feedback.formErrors.guidance")}</p>
            )}
            <ul className="flex list-disc flex-col gap-0.5 ps-4">
              {errors.map((item, index) => (
                <li key={`${item.fieldId ?? "form"}-${index}`}>
                  {item.fieldId ? (
                    <button
                      type="button"
                      className="cursor-pointer text-start underline underline-offset-2 hover:no-underline focus-visible:rounded-xs focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
                      onClick={() => focusField(item.fieldId!)}
                    >
                      {item.label ? <span className="font-medium">{item.label}: </span> : null}
                      {item.message}
                    </button>
                  ) : (
                    <span>{item.message}</span>
                  )}
                </li>
              ))}
            </ul>
          </AlertDescription>
        </Alert>
      )}
    </div>
  );
}
