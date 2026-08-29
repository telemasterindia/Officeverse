import { createFileRoute, Outlet, redirect } from "@tanstack/react-router";
import { AppShell } from "@/components/officeverse/app-shell";
import { meFn } from "@/lib/officeverse/auth-fns";

export const Route = createFileRoute("/_shell")({
  /**
   * Server-enforced gate for every authenticated Officeverse screen. Runs on
   * the SSR request (cookie available) and on client navigation. The server
   * functions each screen calls also enforce `requireUser` / `requireRole`
   * independently — this is the UX layer, not the only boundary.
   */
  beforeLoad: async () => {
    const { user } = await meFn();
    if (!user) {
      throw redirect({ to: "/" });
    }
    return { authUser: user };
  },
  component: ShellLayout,
});

function ShellLayout() {
  return (
    <AppShell>
      <Outlet />
    </AppShell>
  );
}
