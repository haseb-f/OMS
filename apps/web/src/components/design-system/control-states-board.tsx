"use client";

import { Check, ChevronDown, ShoppingCart, Trash2, UserRound } from "lucide-react";
import { EnterpriseButton } from "@/components/ui/button";
import { EnterpriseCard, EnterpriseCardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { FieldMessage } from "@/components/ui/form";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { SectionHeading } from "@/components/shared/section-heading";
import { useLocale } from "@/providers/locale-provider";

/**
 * Control states board (design-system §12.4, §12.10): every control variant
 * and static state side by side, on real shared primitives. Hover, focus and
 * open states are live.
 */
export function ControlStatesBoard() {
  const { t } = useLocale();
  const k = (key: string) => t(`designSystem.controlStates.${key}` as never);

  return (
    <section className="flex flex-col gap-3" data-testid="control-states-board">
      <SectionHeading title={k("title")} description={k("description")} />
      <EnterpriseCard>
        <EnterpriseCardContent className="flex flex-col gap-5">
          <Row label={k("buttons")}>
            <EnterpriseButton>{k("primary")}</EnterpriseButton>
            <EnterpriseButton variant="success">
              <Check />
              {k("confirm")}
            </EnterpriseButton>
            <EnterpriseButton variant="success">
              <ShoppingCart />
              {t("crm.leads.convert.cta")}
            </EnterpriseButton>
            <EnterpriseButton variant="outline">{k("outline")}</EnterpriseButton>
            <EnterpriseButton variant="ghost">{k("ghost")}</EnterpriseButton>
            <EnterpriseButton variant="destructive">
              <Trash2 />
              {k("destructive")}
            </EnterpriseButton>
            <EnterpriseButton disabled>{k("disabled")}</EnterpriseButton>
            <EnterpriseButton variant="outline" disabled>
              {k("disabled")}
            </EnterpriseButton>
            <EnterpriseButton isLoading>{k("loading")}</EnterpriseButton>
          </Row>

          <Row label={k("selectors")}>
            <Select>
              <SelectTrigger className="w-52" aria-label={k("placeholder")}>
                <SelectValue placeholder={k("placeholder")} />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="a">{k("value")}</SelectItem>
                <SelectItem value="b">{k("filled")}</SelectItem>
              </SelectContent>
            </Select>
            <Select defaultValue="a">
              <SelectTrigger className="w-52" aria-label={k("value")}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="a">{k("value")}</SelectItem>
                <SelectItem value="b">{k("filled")}</SelectItem>
              </SelectContent>
            </Select>
            <EnterpriseButton variant="field" className="w-52 justify-between" aria-invalid>
              <span className="flex items-center gap-1.5 text-placeholder">
                <UserRound />
                {k("placeholder")}
              </span>
              <ChevronDown />
            </EnterpriseButton>
            <EnterpriseButton variant="field" className="w-52 justify-between" disabled>
              <span>{k("disabled")}</span>
              <ChevronDown />
            </EnterpriseButton>
          </Row>

          <Row label={k("inputs")}>
            <Input className="w-52" placeholder={k("placeholder")} aria-label={k("placeholder")} />
            <Input className="w-52" defaultValue={k("filled")} aria-label={k("filled")} />
            <div className="flex w-52 flex-col gap-1">
              <Label htmlFor="states-invalid" className="sr-only">
                {k("invalid")}
              </Label>
              <Input id="states-invalid" aria-invalid defaultValue="" placeholder={k("invalid")} />
              <FieldMessage announce={false}>{k("required")}</FieldMessage>
            </div>
            <Input className="w-52" readOnly value={k("readOnly")} aria-label={k("readOnly")} />
            <Input className="w-52" disabled value={k("disabled")} aria-label={k("disabled")} />
          </Row>
        </EnterpriseCardContent>
      </EnterpriseCard>
    </section>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-2">
      <span className="text-caption font-medium text-muted-foreground">{label}</span>
      <div className="flex flex-wrap items-start gap-2">{children}</div>
    </div>
  );
}
