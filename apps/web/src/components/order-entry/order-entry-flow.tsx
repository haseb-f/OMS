"use client";

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import type { FieldValues, UseFormReturn } from "react-hook-form";
import { EnterpriseModal } from "@/components/shared/enterprise-modal";
import { ConfirmationDialog } from "@/components/shared/confirmation-dialog";
import {
  FormErrorSummary,
  findFieldElement,
  focusElement,
  useFocusFirstInvalid,
  type FormErrorItem,
} from "@/components/shared/form-error-summary";
import { StepFlow, StepFlowFooter } from "@/components/shared/step-flow";
import { EnterpriseCard, EnterpriseCardContent, EnterpriseCardFooter } from "@/components/ui/card";
import { ControlSurface } from "@/components/ui/control-surface";
import { Form } from "@/components/ui/form";
import {
  ORDER_CREATE_STEPS,
  ORDER_CREATE_STEP_LABEL_KEY,
  orderCreateStepIndex,
  type OrderCreateStepId,
  type OrderStepRouting,
} from "@/config/orders/order-create-steps";
import { useLocale } from "@/providers/locale-provider";

/**
 * R15 W1 (D15-19) — the ONE order-entry flow. Company sales staff (store
 * orders), agent users (portal orders and lead conversions) and company staff
 * entering an agent order all walk the same four steps (customer → products →
 * delivery & payment → review) over one form; an adapter supplies the
 * fields, the rules and the submit (`useCompanyOrderEntry`,
 * `useAgentOrderEntry`). This file is the shell they share: step state and
 * focus, "Next" validating only the current step, the error summary that
 * returns to the step holding a field, one submit at a time, and the
 * container — a dialog (bottom sheet on phones) or a page with a sticky
 * footer.
 */

export interface OrderEntryFlowState {
  stepIndex: number;
  step: OrderCreateStepId;
  /** Callback refs of the flow body (field lookups) and the step panel (focus on a step change). */
  setBody: (node: HTMLDivElement | null) => void;
  setStepPanel: (node: HTMLDivElement | null) => void;
  /** The body element (the error summary looks fields up inside it). */
  getBody: () => HTMLDivElement | null;
  /** Shows a step. `focusInvalid` (a failed check) moves focus to its first invalid field instead of the step itself. */
  goToStep: (target: OrderCreateStepId, options?: { focusInvalid?: boolean }) => void;
  focusFirstInvalid: () => void;
}

/** Step state of one flow instance; back to the first step whenever `open` turns on. */
export function useOrderEntryFlow(open: boolean): OrderEntryFlowState {
  const [stepIndex, setStepIndex] = useState(0);
  const bodyRef = useRef<HTMLDivElement>(null);
  const stepPanelRef = useRef<HTMLDivElement>(null);
  const stepFocusPendingRef = useRef(false);
  const focusFirstInvalid = useFocusFirstInvalid(bodyRef);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (open) setStepIndex(0);
  }, [open]);

  // A step change moves focus to the new step (screen readers announce it) and shows its top.
  useEffect(() => {
    if (!stepFocusPendingRef.current) return;
    stepFocusPendingRef.current = false;
    stepPanelRef.current?.focus({ preventScroll: true });
    stepPanelRef.current?.scrollIntoView?.({ block: "start" });
  }, [stepIndex]);

  const goToStep = useCallback(
    (target: OrderCreateStepId, options: { focusInvalid?: boolean } = {}) => {
      const index = orderCreateStepIndex(target);
      if (options.focusInvalid) {
        setStepIndex(index);
        focusFirstInvalid();
        return;
      }
      setStepIndex((current) => {
        if (index !== current) stepFocusPendingRef.current = true;
        return index;
      });
    },
    [focusFirstInvalid],
  );

  const setBody = useCallback((node: HTMLDivElement | null) => {
    bodyRef.current = node;
  }, []);
  const setStepPanel = useCallback((node: HTMLDivElement | null) => {
    stepPanelRef.current = node;
  }, []);
  const getBody = useCallback(() => bodyRef.current, []);

  return {
    stepIndex,
    step: ORDER_CREATE_STEPS[stepIndex],
    setBody,
    setStepPanel,
    getBody,
    goToStep,
    focusFirstInvalid,
  };
}

/** What an adapter gives the flow. */
export interface OrderEntryAdapter<TValues extends FieldValues = FieldValues> {
  form: UseFormReturn<TValues>;
  routing: OrderStepRouting;
  renderStep: (step: OrderCreateStepId) => ReactNode;
  /** "Next": checks only this step; false keeps the user on it. */
  validateStep: (step: OrderCreateStepId) => Promise<boolean>;
  /** The final action (the adapter routes failures back to their step through the flow). */
  submit: () => Promise<void>;
  /** Live: each item disappears as the user fixes it. */
  summaryErrors: FormErrorItem[];
  isSubmitting: boolean;
  isDirty: boolean;
  finalLabel: string;
  /** The final action waits (e.g. receipts still uploading, a quote not current). */
  finalDisabled?: boolean;
}

export function OrderEntryFlow<TValues extends FieldValues>({
  flow,
  adapter,
  container,
  open = true,
  onOpenChange,
  onCancel,
  title,
  description,
  testId,
}: {
  flow: OrderEntryFlowState;
  adapter: OrderEntryAdapter<TValues>;
  container: "dialog" | "page";
  /** Dialog only. */
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  /** Page only: leaving the page (asked first when there are unsaved changes). */
  onCancel?: () => void;
  /** Dialog only (a page shows its own header). */
  title?: string;
  description?: string;
  testId?: string;
}) {
  const { t } = useLocale();
  // Plain values for render; the element setters only ever go to `ref` props.
  const { stepIndex, step, setBody, setStepPanel, goToStep, focusFirstInvalid, getBody } = flow;
  const [checkingStep, setCheckingStep] = useState(false);
  const [discardOpen, setDiscardOpen] = useState(false);
  const submittingRef = useRef(false);
  const lastIndex = ORDER_CREATE_STEPS.length - 1;
  const stepItems = ORDER_CREATE_STEPS.map((id) => ({
    id,
    label: t(ORDER_CREATE_STEP_LABEL_KEY[id]),
  }));

  const goNext = async () => {
    if (checkingStep || stepIndex >= lastIndex) return;
    setCheckingStep(true);
    let valid = false;
    try {
      valid = await adapter.validateStep(step);
    } finally {
      setCheckingStep(false);
    }
    if (!valid) {
      focusFirstInvalid();
      return;
    }
    goToStep(ORDER_CREATE_STEPS[stepIndex + 1]);
  };
  const goBack = () => {
    if (stepIndex > 0) goToStep(ORDER_CREATE_STEPS[stepIndex - 1]);
  };
  const final = async () => {
    // One submit at a time; a retry of the same form reuses the adapter's idempotency key.
    if (submittingRef.current) return;
    submittingRef.current = true;
    try {
      await adapter.submit();
    } finally {
      submittingRef.current = false;
    }
  };

  /** An error-summary item: open the step holding the field, then focus it. */
  const focusSummaryField = (fieldId: string) => {
    const target = adapter.routing.stepForField(fieldId);
    if (target) goToStep(target);
    let attempts = 0;
    const tryFocus = () => {
      const element = findFieldElement(fieldId, getBody() ?? document);
      if (element) {
        focusElement(element);
        return;
      }
      if (++attempts < 10) window.requestAnimationFrame(tryFocus);
    };
    window.requestAnimationFrame(tryFocus);
  };

  const header = (
    <StepFlow
      steps={stepItems}
      currentIndex={stepIndex}
      onStepSelect={(index) => goToStep(ORDER_CREATE_STEPS[index])}
    />
  );
  const errorSummary = (
    <FormErrorSummary errors={adapter.summaryErrors} onFocusField={focusSummaryField} />
  );
  const footer = (requestClose: () => void) => (
    <StepFlowFooter
      currentIndex={stepIndex}
      stepCount={ORDER_CREATE_STEPS.length}
      onBack={goBack}
      onNext={() => void goNext()}
      requestClose={requestClose}
      finalLabel={adapter.finalLabel}
      onFinal={() => void final()}
      isSubmitting={adapter.isSubmitting}
      isBusy={checkingStep}
      finalDisabled={adapter.finalDisabled}
    />
  );
  const body = (
    <Form {...adapter.form}>
      <div ref={setBody}>
        <div
          ref={setStepPanel}
          tabIndex={-1}
          role="group"
          aria-label={stepItems[stepIndex].label}
          data-step={step}
          className="flex scroll-mt-4 flex-col gap-4 outline-none"
        >
          {adapter.renderStep(step)}
        </div>
      </div>
    </Form>
  );

  if (container === "dialog") {
    return (
      <EnterpriseModal
        open={open}
        onOpenChange={onOpenChange ?? (() => undefined)}
        size="lg"
        title={title ?? ""}
        description={description}
        isDirty={adapter.isDirty}
        testId={testId}
        subheader={header}
        errorSummary={errorSummary}
        footer={footer}
      >
        {body}
      </EnterpriseModal>
    );
  }

  // A page: the same header, body and footer on one card; the footer stays reachable on phones.
  const requestLeave = () => {
    if (adapter.isDirty) setDiscardOpen(true);
    else onCancel?.();
  };
  return (
    <ControlSurface surface="form">
      <EnterpriseCard size="sm" className="@container min-w-0 gap-0 py-0" data-testid={testId}>
        <div className="border-b border-border px-(--card-spacing) py-3">{header}</div>
        <EnterpriseCardContent className="flex min-w-0 flex-col gap-3 py-4">
          {errorSummary}
          {body}
        </EnterpriseCardContent>
        <EnterpriseCardFooter className="sticky bottom-0 z-(--z-sticky)">
          {footer(requestLeave)}
        </EnterpriseCardFooter>
      </EnterpriseCard>
      <ConfirmationDialog
        open={discardOpen}
        onOpenChange={setDiscardOpen}
        title={t("common.confirmDiscardTitle")}
        description={t("common.confirmDiscardDescription")}
        confirmLabel={t("common.discard")}
        tone="destructive"
        onConfirm={() => {
          setDiscardOpen(false);
          onCancel?.();
        }}
      />
    </ControlSurface>
  );
}
