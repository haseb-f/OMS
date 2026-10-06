import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { Dialog, DialogContent, DialogTitle } from "./dialog";
import { Popover, PopoverContent, PopoverTrigger, isolatePortalScroll } from "./popover";

afterEach(cleanup);

function wheel(target: Element) {
  const event = new WheelEvent("wheel", { bubbles: true, cancelable: true, deltaY: 120 });
  target.dispatchEvent(event);
  return event;
}

function touchMove(target: Element) {
  const event = new Event("touchmove", { bubbles: true, cancelable: true });
  target.dispatchEvent(event);
  return event;
}

describe("PopoverContent scroll isolation inside a modal dialog (R13 A3)", () => {
  function renderPickerInDialog() {
    render(
      <Dialog open>
        <DialogContent aria-describedby={undefined}>
          <DialogTitle>Edit</DialogTitle>
          <Popover open modal={false}>
            <PopoverTrigger>Open</PopoverTrigger>
            <PopoverContent>
              <div data-testid="list" style={{ maxHeight: 100, overflowY: "auto" }}>
                {Array.from({ length: 40 }, (_, i) => (
                  <div key={i}>Option {i}</div>
                ))}
              </div>
            </PopoverContent>
          </Popover>
        </DialogContent>
      </Dialog>,
    );
  }

  it("the dialog's scroll lock is active (control: a wheel on the page is cancelled)", () => {
    renderPickerInDialog();
    const outside = document.createElement("div");
    document.body.appendChild(outside);
    expect(wheel(outside).defaultPrevented).toBe(true);
    outside.remove();
  });

  it("wheel and touch scrolling on the portaled popover list are not cancelled by the lock", () => {
    renderPickerInDialog();
    const list = screen.getByTestId("list");
    expect(list.closest('[data-slot="popover-content"]')).not.toBeNull();
    // Portaled outside the dialog's DOM node.
    expect(list.closest('[data-slot="dialog-content"]')).toBeNull();
    expect(wheel(list).defaultPrevented).toBe(false);
    expect(touchMove(list).defaultPrevented).toBe(false);
  });

  it("isolatePortalScroll stops wheel/touchmove at the node and can be released", () => {
    const node = document.createElement("div");
    const child = document.createElement("div");
    node.appendChild(child);
    document.body.appendChild(node);
    let reachedDocument = 0;
    const listener = () => {
      reachedDocument += 1;
    };
    document.addEventListener("wheel", listener);
    document.addEventListener("touchmove", listener);
    const release = isolatePortalScroll(node);
    wheel(child);
    touchMove(child);
    expect(reachedDocument).toBe(0);
    release();
    wheel(child);
    expect(reachedDocument).toBe(1);
    document.removeEventListener("wheel", listener);
    document.removeEventListener("touchmove", listener);
    node.remove();
  });
});
