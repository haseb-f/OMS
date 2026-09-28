"use client";

import {
  createContext,
  useCallback,
  useContext,
  useLayoutEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { usePathname } from "next/navigation";
import { UI_PILOT_ENABLED, UI_PILOT_STORAGE_KEY, isUiPilotRoute } from "@/config/ui-pilot";

interface UiPilotValue {
  /** The pilot design is rendering on this route right now. */
  active: boolean;
  /** This route is part of the pilot (the switch is offered). */
  available: boolean;
  /** Reviewer switch between the pilot and the current design. */
  setEnabled: (enabled: boolean) => void;
}

const UiPilotContext = createContext<UiPilotValue>({
  active: false,
  available: false,
  setEnabled: () => {},
});

function readOptOut(): boolean {
  try {
    return window.localStorage.getItem(UI_PILOT_STORAGE_KEY) === "off";
  } catch {
    return false;
  }
}

/**
 * Keeps `data-ui="geist"` on <html> in sync with the route on client
 * navigation (the boot script in the root layout handles the first paint).
 * Inert unless the build enables the pilot.
 */
export function UiPilotProvider({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const available = UI_PILOT_ENABLED && isUiPilotRoute(pathname);
  const [optedOut, setOptedOut] = useState(false);

  useLayoutEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- localStorage is client-only
    if (UI_PILOT_ENABLED) setOptedOut(readOptOut());
  }, []);

  const active = available && !optedOut;

  useLayoutEffect(() => {
    if (!UI_PILOT_ENABLED) return;
    const root = document.documentElement;
    if (active) root.setAttribute("data-ui", "geist");
    else root.removeAttribute("data-ui");
  }, [active]);

  const setEnabled = useCallback((enabled: boolean) => {
    try {
      if (enabled) window.localStorage.removeItem(UI_PILOT_STORAGE_KEY);
      else window.localStorage.setItem(UI_PILOT_STORAGE_KEY, "off");
    } catch {
      /* storage blocked — the switch still applies for this page view */
    }
    setOptedOut(!enabled);
  }, []);

  const value = useMemo(() => ({ active, available, setEnabled }), [active, available, setEnabled]);
  return <UiPilotContext.Provider value={value}>{children}</UiPilotContext.Provider>;
}

export function useUiPilot(): UiPilotValue {
  return useContext(UiPilotContext);
}
