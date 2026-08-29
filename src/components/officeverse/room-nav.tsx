import { Link, useRouterState } from "@tanstack/react-router";
import { NAV_BY_ROLE } from "@/lib/officeverse/nav";
import { useSession } from "@/lib/officeverse/session";
import { cn } from "@/lib/utils";

/**
 * Sidebar navigation for the TeleMaster India shell. Groups, routes and active
 * logic come straight from NAV_BY_ROLE — nothing here changes routing. The
 * active state is a soft filled pill with a thin accent rail; one coherent
 * lucide icon system, no emoji.
 */
export function RoomNavigation({ onNavigate }: { onNavigate?: () => void }) {
  const { user } = useSession();
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  if (!user) return null;
  const groups = NAV_BY_ROLE[user.role];

  return (
    <nav
      className="flex-1 space-y-6 overflow-y-auto px-3 py-5"
      aria-label="TeleMaster India navigation"
    >
      {groups.map((group) => (
        <div key={group.group}>
          <p className="px-3 pb-2 text-[10px] font-bold uppercase tracking-[0.22em] text-sidebar-foreground/45">
            {group.group}
          </p>
          <ul className="space-y-0.5">
            {group.items.map((item) => {
              const active = item.exact ? pathname === item.to : pathname.startsWith(item.to);
              const Icon = item.icon;
              return (
                <li key={item.label}>
                  <Link
                    to={item.to}
                    onClick={onNavigate}
                    aria-current={active ? "page" : undefined}
                    className={cn(
                      "group relative flex items-center gap-3 rounded-xl px-3 py-2 text-sm transition-colors duration-200",
                      active
                        ? "bg-sidebar-accent font-semibold text-sidebar-accent-foreground"
                        : "font-medium text-sidebar-foreground/70 hover:bg-sidebar-accent/50 hover:text-sidebar-accent-foreground",
                    )}
                  >
                    <span
                      aria-hidden
                      className={cn(
                        "absolute left-0 top-1/2 w-[3px] -translate-y-1/2 rounded-r-full bg-primary transition-all duration-200",
                        active
                          ? "h-6 opacity-100"
                          : "h-0 opacity-0 group-hover:h-3 group-hover:opacity-60",
                      )}
                    />
                    <Icon
                      className={cn(
                        "h-[18px] w-[18px] shrink-0 transition-colors",
                        active
                          ? "text-primary"
                          : "text-sidebar-foreground/55 group-hover:text-sidebar-accent-foreground",
                      )}
                    />
                    <span className="truncate">{item.label}</span>
                  </Link>
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </nav>
  );
}
