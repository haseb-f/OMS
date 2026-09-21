"use client";

import { Fragment, useEffect, useSyncExternalStore } from "react";
import { usePathname, useRouter } from "next/navigation";
import { ArrowLeft, ChevronRight } from "lucide-react";
import { EnterpriseButton } from "@/components/ui/button";
import {
  consumeScroll,
  getTrail,
  subscribeTrail,
  syncTrailWithPath,
  takeOrigin,
  type NavigationOrigin,
} from "@/lib/navigation-origin";
import { useLocale } from "@/providers/locale-provider";

const SERVER_TRAIL: NavigationOrigin[] = [];

/** Re-applies the origin's scroll once its (async) content is tall enough. */
function restoreScroll(y: number) {
  let attempts = 0;
  const tick = () => {
    attempts += 1;
    const reachable = document.documentElement.scrollHeight - window.innerHeight >= y - 4;
    if (reachable || attempts > 40) {
      window.scrollTo({ top: y });
      return;
    }
    window.setTimeout(tick, 50);
  };
  tick();
}

/**
 * Contextual return trail shown above the page content while the user is on
 * a record they reached via "Open full record": an explicit "Back to
 * <origin>" plus the chain of documents that led here. Invisible otherwise.
 */
export function NavigationTrail() {
  const pathname = usePathname();
  const router = useRouter();
  const { t } = useLocale();
  const trail = useSyncExternalStore(subscribeTrail, getTrail, () => SERVER_TRAIL);

  useEffect(() => {
    syncTrailWithPath(pathname);
    const y = consumeScroll(pathname);
    if (y !== null) restoreScroll(y);
  }, [pathname]);

  const head = trail.at(-1);
  if (!head || head.target.split("?")[0] !== pathname) return null;

  const returnTo = (index: number) => {
    const origin = takeOrigin(index);
    if (origin) router.push(origin.href, { scroll: false });
  };

  return (
    <nav
      aria-label={t("docFlow.return.trail")}
      data-testid="nav-trail"
      className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 rounded-md border border-primary/20 bg-primary-soft px-2 py-1 text-caption"
    >
      <EnterpriseButton
        type="button"
        size="xs"
        variant="ghost"
        data-testid="nav-trail-back"
        className="text-primary hover:text-primary"
        onClick={() => returnTo(trail.length - 1)}
      >
        <ArrowLeft className="rtl:rotate-180" />
        {t("docFlow.return.backTo", { label: head.label })}
      </EnterpriseButton>
      {trail.length > 1 ? (
        <ol className="flex min-w-0 flex-wrap items-center gap-1 text-muted-foreground">
          {trail.map((entry, index) => (
            <Fragment key={`${entry.href}-${index}`}>
              <li className="min-w-0">
                <button
                  type="button"
                  className="max-w-48 truncate hover:text-foreground hover:underline"
                  onClick={() => returnTo(index)}
                >
                  {entry.label}
                </button>
              </li>
              <li aria-hidden>
                <ChevronRight className="size-3 rtl:rotate-180" />
              </li>
            </Fragment>
          ))}
          <li aria-current="page" className="max-w-48 truncate font-medium text-foreground">
            {head.targetLabel}
          </li>
        </ol>
      ) : null}
    </nav>
  );
}
