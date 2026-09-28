"use client";

import { useEffect, useState } from "react";
import {
  agentPortalService,
  type CountryRef,
  type PortalMe,
} from "@/services/agent-portal-service";

/**
 * The agent portal profile (`GET /agent-portal/me`: agent identity and
 * settlement currency) and the destination countries for leads / orders
 * (`GET /agent-portal/countries` — every active country; whether shipping is
 * priced is the quote's decision, never the country list's).
 */
export function usePortalProfile({ withCountries = true }: { withCountries?: boolean } = {}) {
  const [profile, setProfile] = useState<PortalMe | null>(null);
  const [failed, setFailed] = useState(false);
  const [countries, setCountries] = useState<Array<CountryRef & { code: string }>>([]);
  const [countriesLoaded, setCountriesLoaded] = useState(!withCountries);

  useEffect(() => {
    let cancelled = false;
    agentPortalService
      .me()
      .then((me) => {
        if (!cancelled) setProfile(me);
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      });
    if (withCountries) {
      agentPortalService
        .countries()
        .then((rows) => {
          if (!cancelled) setCountries(rows);
        })
        .catch(() => undefined)
        .finally(() => {
          if (!cancelled) setCountriesLoaded(true);
        });
    }
    return () => {
      cancelled = true;
    };
  }, [withCountries]);

  return { profile, failed, countries, loading: (!profile && !failed) || !countriesLoaded };
}
