import { HomeLauncher } from "@/components/home/home-launcher";

/**
 * Agent portal Home (`/agent`): the permission-aware launcher an agent login
 * lands on (Agent Admin and Agent Sales see different tiles). The agent
 * dashboard lives separately at `/agent/dashboard`.
 */
export default function AgentHomePage() {
  return <HomeLauncher />;
}
