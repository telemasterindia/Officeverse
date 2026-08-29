/**
 * Officeverse — header notification bell (Phase 6).
 *
 * DB-backed: unread count + a short recent-notifications panel from the
 * Phase-5 server service. No localStorage. Preserves the existing bell icon +
 * badge; adds a lightweight dropdown panel.
 */
import { Link, useNavigate } from "@tanstack/react-router";
import { Bell } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import { notificationHref } from "@/lib/officeverse/notification-link";
import {
  useMarkAllNotificationsRead,
  useMarkNotificationRead,
  useNotificationList,
  useUnreadNotificationCount,
} from "@/lib/officeverse/use-notifications";

const PANEL_SIZE = 6;

function relativeTime(iso: string): string {
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return "";
  const diff = Date.now() - t;
  const m = Math.round(diff / 60_000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.round(h / 24);
  return `${d}d ago`;
}

export function NotificationBell() {
  const navigate = useNavigate();
  const { unread } = useUnreadNotificationCount({ poll: true });
  const list = useNotificationList({ pageSize: PANEL_SIZE });
  const markRead = useMarkNotificationRead();
  const markAll = useMarkAllNotificationsRead();

  const items = list.data?.notifications ?? [];

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" className="relative" aria-label="Notifications">
          <Bell className="h-5 w-5" />
          {unread > 0 ? (
            <span className="absolute right-1.5 top-1.5 grid h-4 min-w-4 place-items-center rounded-full bg-destructive px-1 text-[10px] font-bold text-destructive-foreground">
              {unread > 99 ? "99+" : unread}
            </span>
          ) : null}
        </Button>
      </DropdownMenuTrigger>

      <DropdownMenuContent align="end" className="w-[340px] p-0">
        <div className="flex items-center justify-between border-b border-border px-3 py-2">
          <span className="text-sm font-semibold">Notifications</span>
          <button
            type="button"
            className="text-xs font-medium text-muted-foreground hover:text-foreground disabled:opacity-50"
            disabled={unread === 0 || markAll.isPending}
            onClick={() => markAll.mutate()}
          >
            Mark all read
          </button>
        </div>

        <div className="max-h-[360px] overflow-y-auto">
          {list.isLoading ? (
            <p className="px-3 py-6 text-center text-sm text-muted-foreground">Loading…</p>
          ) : list.isError ? (
            <div className="px-3 py-6 text-center text-sm">
              <p className="text-muted-foreground">Couldn't load notifications.</p>
              <button
                type="button"
                className="mt-2 text-xs font-semibold text-primary hover:underline"
                onClick={() => list.refetch()}
              >
                Retry
              </button>
            </div>
          ) : items.length === 0 ? (
            <p className="px-3 py-6 text-center text-sm text-muted-foreground">
              You're all caught up.
            </p>
          ) : (
            items.map((n) => {
              const href = notificationHref(n);
              return (
                <button
                  key={n.id}
                  type="button"
                  className={cn(
                    "block w-full border-b border-border/60 px-3 py-2.5 text-left transition-colors last:border-b-0 hover:bg-secondary/60",
                    n.unread && "bg-primary/5",
                  )}
                  onClick={() => {
                    if (n.unread) markRead.mutate(n.id);
                    if (href) navigate(href);
                  }}
                >
                  <span className="flex items-center gap-2">
                    {n.unread ? (
                      <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-primary" aria-hidden />
                    ) : null}
                    <span className="truncate text-sm font-medium">{n.title}</span>
                    <span className="ml-auto shrink-0 text-[10px] text-muted-foreground">
                      {relativeTime(n.created_at)}
                    </span>
                  </span>
                  <span className="mt-0.5 line-clamp-2 block text-xs text-muted-foreground">
                    {n.message}
                  </span>
                </button>
              );
            })
          )}
        </div>

        <div className="border-t border-border px-3 py-2 text-center">
          <Link to="/notifications" className="text-xs font-semibold text-primary hover:underline">
            View all
          </Link>
        </div>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
