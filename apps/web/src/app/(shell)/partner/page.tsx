import { HomeLauncher } from "@/components/home/home-launcher";

/**
 * Partner portal Home (`/partner`, R15 D15-14): the permission-aware launcher
 * a company partner's login lands on — its tiles are the partner-audience
 * navigation entries (Overview, Statement) the login may open.
 */
export default function PartnerHomePage() {
  return <HomeLauncher />;
}
