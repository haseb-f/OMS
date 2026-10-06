"use client";

import * as React from "react";
import { Popover as PopoverPrimitive } from "radix-ui";

import { cn } from "@/lib/utils";

function Popover({ ...props }: React.ComponentProps<typeof PopoverPrimitive.Root>) {
  return <PopoverPrimitive.Root data-slot="popover" {...props} />;
}

function PopoverTrigger({ ...props }: React.ComponentProps<typeof PopoverPrimitive.Trigger>) {
  return <PopoverPrimitive.Trigger data-slot="popover-trigger" {...props} />;
}

/**
 * Scroll isolation for portaled popover content (R13 A3).
 *
 * A modal Radix Dialog / Sheet locks scrolling with react-remove-scroll, which
 * listens for `wheel` / `touchmove` on `document` and cancels every event whose
 * target is outside the dialog's own DOM node. A non-modal popover (pickers,
 * comboboxes, the calling-code list) is portaled to `<body>`, so its list could
 * not be scrolled by wheel or touch while a dialog was open. Stopping those two
 * events from bubbling past the popover keeps them away from the lock: the
 * browser scrolls the list natively, the list's `overscroll-contain` stops any
 * chaining, and the page itself stays locked (the lock's body `overflow:
 * hidden` is untouched). Native listeners — not React handlers — so it works
 * whatever node React's root listener is attached to.
 */
function stopScrollPropagation(event: Event) {
  event.stopPropagation();
}

export function isolatePortalScroll(node: HTMLElement): () => void {
  const options: AddEventListenerOptions = { passive: true };
  node.addEventListener("wheel", stopScrollPropagation, options);
  node.addEventListener("touchmove", stopScrollPropagation, options);
  return () => {
    node.removeEventListener("wheel", stopScrollPropagation, options);
    node.removeEventListener("touchmove", stopScrollPropagation, options);
  };
}

function PopoverContent({
  className,
  ref,
  align = "center",
  sideOffset = 4,
  // Keep every popover (pickers, filters, date pickers) a gutter away from
  // the viewport edge on phones — never full-bleed or momentarily off-screen.
  collisionPadding = 8,
  onCloseAutoFocus,
  ...props
}: React.ComponentProps<typeof PopoverPrimitive.Content>) {
  const contentRef = React.useCallback(
    (node: HTMLDivElement | null) => {
      if (typeof ref === "function") ref(node);
      else if (ref) ref.current = node;
      if (!node) return;
      const release = isolatePortalScroll(node);
      return () => {
        release();
        if (typeof ref === "function") ref(null);
        else if (ref) ref.current = null;
      };
    },
    [ref],
  );
  return (
    <PopoverPrimitive.Portal>
      <PopoverPrimitive.Content
        ref={contentRef}
        data-slot="popover-content"
        align={align}
        sideOffset={sideOffset}
        collisionPadding={collisionPadding}
        onCloseAutoFocus={(event) => {
          onCloseAutoFocus?.(event);
          if (event.defaultPrevented) return;
          // The close fades out before Radix restores focus to the trigger. If
          // the user has already moved on (e.g. opened the next picker), keep
          // their focus — stealing it back would close what they just opened.
          const active = document.activeElement;
          if (
            active &&
            active !== document.body &&
            !active.closest('[data-slot="popover-content"]')
          ) {
            event.preventDefault();
          }
        }}
        className={cn(
          "z-50 flex w-72 origin-(--radix-popover-content-transform-origin) flex-col gap-2.5 rounded-md bg-popover p-2.5 text-sm text-popover-foreground border border-border shadow-(--shadow-floating) outline-hidden duration-(--duration-base) data-open:animate-in data-open:fade-in-0 data-closed:animate-out data-closed:fade-out-0 ",
          className,
        )}
        {...props}
      />
    </PopoverPrimitive.Portal>
  );
}

function PopoverAnchor({ ...props }: React.ComponentProps<typeof PopoverPrimitive.Anchor>) {
  return <PopoverPrimitive.Anchor data-slot="popover-anchor" {...props} />;
}

function PopoverHeader({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="popover-header"
      className={cn("flex flex-col gap-0.5 text-sm", className)}
      {...props}
    />
  );
}

function PopoverTitle({ className, ...props }: React.ComponentProps<"h2">) {
  return <div data-slot="popover-title" className={cn("font-medium", className)} {...props} />;
}

function PopoverDescription({ className, ...props }: React.ComponentProps<"p">) {
  return (
    <p
      data-slot="popover-description"
      className={cn("text-muted-foreground", className)}
      {...props}
    />
  );
}

export {
  Popover,
  PopoverAnchor,
  PopoverContent,
  PopoverDescription,
  PopoverHeader,
  PopoverTitle,
  PopoverTrigger,
};
