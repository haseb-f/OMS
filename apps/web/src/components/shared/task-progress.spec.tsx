import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render } from "@testing-library/react";
import type { ReactNode } from "react";
import { LocaleProvider } from "@/providers/locale-provider";
import { messages } from "@/i18n/messages";
import { TaskProgress, taskStatusFromCounts } from "./task-progress";

const wrap = (node: ReactNode) => <LocaleProvider>{node}</LocaleProvider>;
const ar = messages.ar.feedback.task;

function countValue(container: HTMLElement, key: string) {
  return container.querySelector(`[data-count=${key}] dd`)?.textContent;
}

describe("TaskProgress", () => {
  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  it("shows completion counts and hides a zero skipped count", () => {
    const { container } = render(
      wrap(<TaskProgress status="partial" total={10} succeeded={7} failed={3} skipped={0} />),
    );
    expect(countValue(container, "total")).toBe("10");
    expect(countValue(container, "succeeded")).toBe("7");
    expect(countValue(container, "failed")).toBe("3");
    expect(container.querySelector("[data-count=skipped]")).toBeNull();
    expect(container.textContent).toContain(ar.partial);
  });

  it("is determinate when total and processed are known", () => {
    const { container } = render(
      wrap(<TaskProgress status="running" total={200} processed={50} />),
    );
    const bar = container.querySelector("[role=progressbar]")!;
    expect(bar.getAttribute("aria-valuenow")).toBe("25");
    expect(container.textContent).toContain(
      ar.processedOf.replace("{processed}", "50").replace("{total}", "200"),
    );
  });

  it("is indeterminate when only the total is known", () => {
    const { container } = render(wrap(<TaskProgress status="running" total={12} />));
    const bar = container.querySelector("[role=progressbar]")!;
    expect(bar.getAttribute("aria-valuenow")).toBeNull();
    expect(bar.getAttribute("aria-valuetext")).toBe(ar.processingTotal.replace("{total}", "12"));
  });

  it("lists the first N errors and expands to all", () => {
    const errors = Array.from({ length: 8 }, (_, i) => ({
      id: String(i),
      label: `Row ${i + 2}`,
      message: `Bad value ${i}`,
    }));
    const { container, getByText } = render(
      wrap(<TaskProgress status="failed" failed={8} succeeded={0} errors={errors} maxErrors={5} />),
    );
    expect(container.querySelectorAll("li")).toHaveLength(5);
    fireEvent.click(getByText(ar.showAll.replace("{count}", "8")));
    expect(container.querySelectorAll("li")).toHaveLength(8);
  });

  it("offers retry only once the task has stopped", () => {
    const onRetry = vi.fn();
    const view = render(wrap(<TaskProgress status="running" onRetry={onRetry} />));
    expect(view.queryByText(ar.retry)).toBeNull();
    view.rerender(wrap(<TaskProgress status="failed" onRetry={onRetry} />));
    fireEvent.click(view.getByText(ar.retry));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it("throttles running announcements and announces completion once", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-27T10:00:00Z"));
    const view = render(
      wrap(<TaskProgress status="running" total={100} processed={10} announceIntervalMs={5000} />),
    );
    const live = () => view.container.querySelector("[aria-live=polite]")!.textContent;
    const progressText = (n: number) =>
      ar.announceProgress.replace("{processed}", String(n)).replace("{total}", "100");
    expect(live()).toBe(progressText(10));

    view.rerender(
      wrap(<TaskProgress status="running" total={100} processed={20} announceIntervalMs={5000} />),
    );
    expect(live()).toBe(progressText(10)); // within the interval: not re-announced

    vi.setSystemTime(new Date("2026-09-27T10:00:06Z"));
    view.rerender(
      wrap(<TaskProgress status="running" total={100} processed={60} announceIntervalMs={5000} />),
    );
    expect(live()).toBe(progressText(60));

    view.rerender(wrap(<TaskProgress status="succeeded" total={100} succeeded={100} failed={0} />));
    expect(live()).toBe(
      ar.announceDone
        .replace("{status}", ar.succeeded)
        .replace("{succeeded}", "100")
        .replace("{failed}", "0"),
    );
  });
});

describe("taskStatusFromCounts", () => {
  it("maps counts to an outcome", () => {
    expect(taskStatusFromCounts(5, 0)).toBe("succeeded");
    expect(taskStatusFromCounts(5, 1)).toBe("partial");
    expect(taskStatusFromCounts(0, 3)).toBe("failed");
  });
});
