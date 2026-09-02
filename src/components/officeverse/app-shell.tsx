import { Link, useNavigate, useRouterState } from "@tanstack/react-router";
import { Bell, LogOut, Menu, Moon, Search, Settings, Sun, UserCircle, X } from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { PROCESSES, ROLE_LABEL } from "@/lib/officeverse/data";
import { useSession } from "@/lib/officeverse/session";
import type { ProcessCode } from "@/lib/officeverse/types";
import { roomForPath } from "@/lib/officeverse/visual";
import { useEmployeePhoto } from "@/lib/officeverse/identity";
import { photoDataUrl, useProfilePhoto } from "@/lib/officeverse/use-photo";
import { PhotoDisplay } from "./photo/PhotoDisplay";
import { RoomNavigation } from "./room-nav";
import { ShiftBadge } from "./shift-badge";
import { SearchCommand } from "./search-command";
import { QuotePopup } from "./quote-popup";
import { FollowUpReminders } from "./follow-up-reminders";
import { NotificationBell } from "./notification-bell";
import { UsTimezoneWatches } from "./us-timezone-watches";

function Brand() {
  return (
    <div className="flex min-w-0 items-center gap-3">
      <span
        className="grid h-10 w-10 shrink-0 place-items-center rounded-2xl font-display text-lg font-black text-primary-foreground"
        style={{ backgroundImage: "var(--gradient-hero)" }}
        aria-hidden
      >
        T
      </span>
      <span className="min-w-0">
        <span className="block truncate font-display text-sm font-black tracking-[0.16em] text-sidebar-foreground">
          TELEMASTER INDIA
        </span>
        <span className="block truncate text-[11px] text-sidebar-foreground/55">
          Your work. Your leads. Your wins.
        </span>
      </span>
    </div>
  );
}

function TopBar({
  onOpenSearch,
  onOpenMenu,
}: {
  onOpenSearch: () => void;
  onOpenMenu: () => void;
}) {
  const { user, theme, toggleTheme, signOut, setProcess } = useSession();
  const navigate = useNavigate();
  // Canonical identity = the real Phase-19 server photo; the per-device
  // localStorage photo is the fallback; otherwise a professional initials chip.
  const serverPhoto = photoDataUrl(useProfilePhoto().data);
  const localPhoto = useEmployeePhoto(user?.name ?? "");
  const photo = serverPhoto ?? localPhoto ?? null;
  if (!user) return null;

  return (
    <header className="sticky top-0 z-30 grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-3 border-b border-border bg-card/95 px-4 py-3 backdrop-blur lg:px-6">
      <Button
        variant="ghost"
        size="icon"
        className="lg:hidden"
        onClick={onOpenMenu}
        aria-label="Open menu"
      >
        <Menu className="h-5 w-5" />
      </Button>
      <div className="min-w-0">
        <button
          type="button"
          onClick={onOpenSearch}
          className="flex w-full max-w-md items-center gap-2 rounded-xl border border-border bg-secondary/40 px-3 py-2 text-left text-sm text-muted-foreground transition-colors hover:bg-secondary/70"
        >
          <Search className="h-4 w-4 shrink-0" />
          <span className="truncate">Search Lead ID or Phone…</span>
          <kbd className="ml-auto hidden shrink-0 rounded-md border border-border px-1.5 py-0.5 font-mono text-[10px] sm:block">
            ⌘K
          </kbd>
        </button>
      </div>
      <div className="flex shrink-0 items-center gap-1 sm:gap-2">
        <div className="hidden md:block">
          {user.role === "admin" ? (
            /* Admin assigns the employee's process. */
            <Select value={user.process} onValueChange={(v) => setProcess(v as ProcessCode)}>
              <SelectTrigger className="w-[150px] rounded-xl" aria-label="Process">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {Object.values(PROCESSES).map((p) => (
                  <SelectItem key={p.code} value={p.code}>
                    {p.flags} {p.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          ) : (
            /* Agents / closers / HR — their active session, shown as information. */
            <span
              data-shift={user.process}
              className="inline-flex items-center gap-2 rounded-xl border border-border px-3 py-1.5"
              style={{ background: "var(--shift-tint)" }}
              title="Your active shift — set at check-in"
            >
              <span aria-hidden className="text-sm leading-none">
                {PROCESSES[user.process].flags}
              </span>
              <span className="flex flex-col leading-tight">
                <span className="font-display text-[11px] font-black uppercase tracking-[0.12em]">
                  {PROCESSES[user.process].shift}
                </span>
                <span className="text-[10px] text-muted-foreground">
                  {PROCESSES[user.process].hours}
                </span>
              </span>
              <span className="ml-1 inline-flex items-center gap-1 text-[10px] font-semibold text-success">
                <span className="h-1.5 w-1.5 rounded-full bg-success" /> Online
              </span>
            </span>
          )}
        </div>
        <Button variant="ghost" size="icon" onClick={toggleTheme} aria-label="Switch theme">
          {theme === "dark" ? <Sun className="h-5 w-5" /> : <Moon className="h-5 w-5" />}
        </Button>
        <NotificationBell />
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button className="flex items-center gap-2 rounded-xl px-1.5 py-1 transition-colors hover:bg-secondary/60">
              <PhotoDisplay
                src={photo}
                name={user.name}
                process={user.process}
                size="sm"
                presence="online"
              />
              <span className="hidden min-w-0 text-left sm:block">
                <span className="block truncate text-sm font-semibold leading-tight">
                  {user.name.split(" ")[0]}
                </span>
                <span className="block truncate text-[11px] text-muted-foreground">
                  {ROLE_LABEL[user.role]}
                </span>
              </span>
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-56">
            <DropdownMenuLabel>
              <div className="flex items-center gap-2">
                <PhotoDisplay src={photo} name={user.name} process={user.process} size="sm" />
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold">{user.name}</p>
                  <p className="truncate text-xs font-normal text-muted-foreground">
                    {ROLE_LABEL[user.role]} · {PROCESSES[user.process].flags}
                  </p>
                </div>
              </div>
            </DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuItem asChild>
              <Link to="/profile">
                <UserCircle className="mr-2 h-4 w-4" /> My Profile
              </Link>
            </DropdownMenuItem>
            <DropdownMenuItem asChild>
              <Link to="/notifications">
                <Bell className="mr-2 h-4 w-4" /> Notifications
              </Link>
            </DropdownMenuItem>
            <DropdownMenuItem asChild>
              <Link to="/settings">
                <Settings className="mr-2 h-4 w-4" /> Settings
              </Link>
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              onClick={() => {
                signOut();
                navigate({ to: "/" });
              }}
            >
              <LogOut className="mr-2 h-4 w-4" /> Logout
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </header>
  );
}

export function AppShell({ children }: { children: ReactNode }) {
  const { user, ready } = useSession();
  const navigate = useNavigate();
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const room = roomForPath(pathname);
  const [searchOpen, setSearchOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);

  useEffect(() => {
    if (ready && !user) navigate({ to: "/" });
  }, [ready, user, navigate]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key.toLowerCase() === "k" && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        setSearchOpen((o) => !o);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  if (!ready || !user) {
    return (
      <div className="grid min-h-screen place-items-center bg-background">
        <div className="h-10 w-10 animate-spin rounded-full border-2 border-primary border-t-transparent" />
      </div>
    );
  }

  return (
    <div
      className="relative flex min-h-screen w-full"
      data-room={room}
      data-shift={user.process}
      data-process={user.process}
    >
      {/* Light working background — a near-flat cool neutral with a faint floor. */}
      <div aria-hidden className="room-bg pointer-events-none fixed inset-0 -z-10" />
      <div aria-hidden className="room-floor" />

      <aside className="hidden w-64 shrink-0 flex-col border-r border-sidebar-border bg-sidebar text-sidebar-foreground lg:flex">
        <div className="px-4 py-4">
          <Link to={"/"} className="block">
            <Brand />
          </Link>
        </div>
        <RoomNavigation />
        <div className="space-y-3 border-t border-sidebar-border p-4">
          <ShiftBadge code={user.process} showHours className="flex w-full justify-center" />
          {user.role === "agent" ? (
            <div>
              <p className="mb-1.5 text-[9px] font-bold uppercase tracking-[0.16em] text-sidebar-foreground/45">
                US timezones
              </p>
              <UsTimezoneWatches />
            </div>
          ) : null}
        </div>
      </aside>

      {menuOpen ? (
        <div className="fixed inset-0 z-50 lg:hidden">
          <div
            className="absolute inset-0 bg-background/70 backdrop-blur-sm"
            onClick={() => setMenuOpen(false)}
          />
          <div className="absolute inset-y-0 left-0 flex w-72 flex-col border-r border-sidebar-border bg-sidebar text-sidebar-foreground">
            <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-2 px-4 py-4">
              <Brand />
              <Button
                variant="ghost"
                size="icon"
                onClick={() => setMenuOpen(false)}
                aria-label="Close menu"
              >
                <X className="h-5 w-5" />
              </Button>
            </div>
            <RoomNavigation onNavigate={() => setMenuOpen(false)} />
          </div>
        </div>
      ) : null}

      <div className="relative flex min-w-0 flex-1 flex-col">
        <TopBar onOpenSearch={() => setSearchOpen(true)} onOpenMenu={() => setMenuOpen(true)} />
        <main
          key={pathname}
          className="animate-door-in relative mx-auto w-full max-w-[1440px] flex-1 px-4 py-6 lg:px-8 lg:py-10"
        >
          {children}
        </main>
      </div>

      <SearchCommand open={searchOpen} onOpenChange={setSearchOpen} />
      <QuotePopup />
      <FollowUpReminders />
    </div>
  );
}
