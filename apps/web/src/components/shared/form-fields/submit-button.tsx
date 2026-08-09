import { Loader2 } from "lucide-react";
import { EnterpriseButton } from "@/components/ui/button";

/** Loading + disabled state handled in one place — every form submit button should use this instead of a raw `<EnterpriseButton>`. */
export function SubmitButton({
  children,
  isSubmitting,
  disabled,
  ...props
}: React.ComponentProps<typeof EnterpriseButton> & { isSubmitting?: boolean }) {
  return (
    <EnterpriseButton type="submit" disabled={isSubmitting || disabled} {...props}>
      {isSubmitting && <Loader2 className="animate-spin" />}
      {children}
    </EnterpriseButton>
  );
}
