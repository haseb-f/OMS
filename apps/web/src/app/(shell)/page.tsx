import { HomeLauncher } from "@/components/home/home-launcher";

/**
 * Home (`/`): the permission-aware launcher every company login lands on. The
 * Dashboard lives separately at `/dashboard`.
 */
export default function HomePage() {
  return <HomeLauncher />;
}
