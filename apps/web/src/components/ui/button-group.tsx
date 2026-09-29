import { cva, type VariantProps } from "class-variance-authority";
import { Slot } from "radix-ui";
import type { ComponentProps } from "react";

import { Separator } from "@/components/ui/separator";
import { cn } from "@/lib/utils";

/**
 * Connected controls (Kumo ButtonGroup, kumo-research.md §4): one outer
 * rounding, square inner edges, and each item after the first pulled back
 * 1px so neighbouring edges overlap into ONE separator — never a doubled
 * border. The hovered / open / focused item is lifted so its full edge
 * shows. Items drop their own drop shadow (recipe). Logical properties, so
 * the order mirrors correctly in RTL. Only for controls that genuinely act
 * together (pager, expand/collapse, split button) — never to line up
 * unrelated actions.
 */
const buttonGroupVariants = cva(
  "group/button-group relative isolate flex w-fit items-stretch has-[>[data-slot=button-group]]:gap-2 [&>[data-slot=select-trigger]:not([class*='w-'])]:w-fit *:relative *:not-disabled:hover:z-[1] *:aria-expanded:z-[1] *:data-[state=open]:z-[1] *:focus-visible:z-10 *:has-[:focus-visible]:z-10",
  {
    variants: {
      orientation: {
        horizontal:
          "[&>*:not(:first-child)]:-ms-px [&>*:not(:first-child)]:rounded-s-none [&>*:not(:last-child)]:rounded-e-none",
        vertical:
          "flex-col [&>*:not(:first-child)]:-mt-px [&>*:not(:first-child)]:rounded-t-none [&>*:not(:last-child)]:rounded-b-none",
      },
    },
    defaultVariants: {
      orientation: "horizontal",
    },
  },
);

function ButtonGroup({
  className,
  orientation,
  ...props
}: ComponentProps<"div"> & VariantProps<typeof buttonGroupVariants>) {
  return (
    <div
      role="group"
      data-slot="button-group"
      data-orientation={orientation ?? "horizontal"}
      className={cn(buttonGroupVariants({ orientation }), className)}
      {...props}
    />
  );
}

function ButtonGroupText({
  className,
  asChild = false,
  ...props
}: ComponentProps<"div"> & { asChild?: boolean }) {
  const Comp = asChild ? Slot.Root : "div";

  return (
    <Comp
      className={cn(
        "flex items-center gap-2 rounded-sm border border-(--control-border) bg-muted px-2.5 text-[length:var(--text-button)] font-medium text-muted-foreground [&_svg]:pointer-events-none [&_svg:not([class*='size-'])]:size-4",
        className,
      )}
      {...props}
    />
  );
}

function ButtonGroupSeparator({
  className,
  orientation = "vertical",
  ...props
}: ComponentProps<typeof Separator>) {
  return (
    <Separator
      data-slot="button-group-separator"
      orientation={orientation}
      className={cn(
        "relative self-stretch bg-input data-horizontal:mx-px data-horizontal:w-auto data-vertical:my-px data-vertical:h-auto",
        className,
      )}
      {...props}
    />
  );
}

export { ButtonGroup, ButtonGroupSeparator, ButtonGroupText, buttonGroupVariants };
