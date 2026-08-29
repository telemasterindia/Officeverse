/**
 * Officeverse — client session context (Phase 9).
 *
 * Identity is the SERVER SESSION only. `useSession().user` is derived from
 * `meFn()` (httpOnly cookie → DB/dev session → sanitized PublicUser). The
 * browser cannot set the user id, role, or validity: there is no writable
 * localStorage identity any more.
 *
 * localStorage is still used for genuine UI PREFERENCES ONLY — theme, the
 * illustrated avatar, and the "quote seen today" flag. None of these affect
 * authentication or authorization.
 */
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate, useRouterState } from "@tanstack/react-router";
import { loginFn, logoutFn, meFn } from "./auth-fns";
import { avatarFromSeed, normalizeAvatar } from "./avatar";
import { toSessionUser } from "./session-user";
import type { AvatarConfig, ProcessCode, SessionUser } from "./types";

const QUOTE_KEY = "officeverse.quoteShown";
const THEME_KEY = "officeverse.theme";
const AVATAR_KEY = "officeverse.avatar";
const AUTH_TICK_KEY = "officeverse.auth_tick"; // cross-tab change signal (no identity)

const AUTH_QUERY_KEY = ["auth", "me"] as const;
const PUBLIC_PATHS = ["/", "/login"];

type Theme = "dark" | "light";

interface SessionState {
  user: SessionUser | null;
  ready: boolean;
  devMode: boolean;
  theme: Theme;
  quoteSeen: boolean;
  avatar: AvatarConfig | null;
  signIn: (email: string, password: string) => Promise<void>;
  signOut: () => Promise<void>;
  /** client-only display override — the server always uses the DB user's process */
  setProcess: (p: ProcessCode) => void;
  setAvatar: (config: AvatarConfig) => void;
  toggleTheme: () => void;
  markQuoteSeen: () => void;
}

const SessionContext = createContext<SessionState | null>(null);

function todayKey() {
  return new Date().toISOString().slice(0, 10);
}

function bumpAuthTick() {
  try {
    localStorage.setItem(AUTH_TICK_KEY, String(Date.now()));
  } catch {
    /* ignore */
  }
}

export function SessionProvider({ children }: { children: ReactNode }) {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const pathname = useRouterState({ select: (s) => s.location.pathname });

  const meQuery = useQuery({
    queryKey: AUTH_QUERY_KEY,
    queryFn: () => meFn(),
    staleTime: 30_000,
    retry: false,
    refetchOnWindowFocus: true,
    // Phase 9A: a modest interval keeps the server session's `last_seen_at`
    // fresh (via resolveSession's own throttled bump) so Admin presence can
    // tell ONLINE from IDLE. It does NOT drive auth — just activity.
    refetchInterval: 2 * 60_000,
    refetchIntervalInBackground: false,
  });

  const publicUser = meQuery.data?.user ?? null;
  const devMode = meQuery.data?.devMode ?? false;
  const ready = !meQuery.isLoading;

  const [theme, setTheme] = useState<Theme>("light");
  const [quoteSeen, setQuoteSeen] = useState(true);
  const [avatarMap, setAvatarMap] = useState<Record<string, AvatarConfig>>({});
  const [processOverride, setProcessOverride] = useState<ProcessCode | null>(null);

  /* ---- preference bootstrap (theme / avatar / quote only) ---- */
  useEffect(() => {
    try {
      const t = (localStorage.getItem(THEME_KEY) as Theme | null) ?? "light";
      setTheme(t);
      setQuoteSeen(localStorage.getItem(QUOTE_KEY) === todayKey());
      const am = localStorage.getItem(AVATAR_KEY);
      if (am) {
        const parsed = JSON.parse(am);
        if (parsed && typeof parsed === "object") {
          setAvatarMap(parsed as Record<string, AvatarConfig>);
        }
      }
    } catch {
      /* ignore */
    }
  }, []);

  useEffect(() => {
    const root = document.documentElement;
    root.classList.toggle("light", theme === "light");
    root.classList.toggle("dark", theme === "dark");
  }, [theme]);

  /* ---- cross-tab: another tab logged in / out → re-check identity ---- */
  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key === AUTH_TICK_KEY) {
        void qc.invalidateQueries({ queryKey: AUTH_QUERY_KEY });
      }
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, [qc]);

  /* ---- expired / lost session while on a protected page → to login ---- */
  useEffect(() => {
    if (ready && !publicUser && !PUBLIC_PATHS.includes(pathname)) {
      void navigate({ to: "/" });
    }
  }, [ready, publicUser, pathname, navigate]);

  const user = useMemo<SessionUser | null>(
    () => (publicUser ? toSessionUser(publicUser, processOverride) : null),
    [publicUser, processOverride],
  );

  const signIn = useCallback(
    async (email: string, password: string) => {
      await loginFn({ data: { email, password } });
      setProcessOverride(null);
      setQuoteSeen(false);
      bumpAuthTick();
      await qc.invalidateQueries({ queryKey: AUTH_QUERY_KEY });
    },
    [qc],
  );

  const signOut = useCallback(async () => {
    try {
      await logoutFn();
    } finally {
      setProcessOverride(null);
      qc.setQueryData(AUTH_QUERY_KEY, { user: null, devMode });
      bumpAuthTick();
      await qc.invalidateQueries({ queryKey: AUTH_QUERY_KEY });
      void navigate({ to: "/" });
    }
  }, [qc, devMode, navigate]);

  const setProcess = useCallback((p: ProcessCode) => setProcessOverride(p), []);

  const setAvatar = useCallback(
    (config: AvatarConfig) => {
      if (!user) return;
      setAvatarMap((prev) => {
        const next = { ...prev, [user.id]: normalizeAvatar(config) };
        try {
          localStorage.setItem(AVATAR_KEY, JSON.stringify(next));
        } catch {
          /* ignore */
        }
        return next;
      });
    },
    [user],
  );

  const toggleTheme = useCallback(() => {
    setTheme((prev) => {
      const next = prev === "dark" ? "light" : "dark";
      try {
        localStorage.setItem(THEME_KEY, next);
      } catch {
        /* ignore */
      }
      return next;
    });
  }, []);

  const markQuoteSeen = useCallback(() => {
    setQuoteSeen(true);
    try {
      localStorage.setItem(QUOTE_KEY, todayKey());
    } catch {
      /* ignore */
    }
  }, []);

  const avatar = useMemo<AvatarConfig | null>(() => {
    if (!user) return null;
    const saved = avatarMap[user.id];
    return saved ? normalizeAvatar(saved) : avatarFromSeed(`${user.id}|${user.name}`);
  }, [user, avatarMap]);

  const value = useMemo<SessionState>(
    () => ({
      user,
      ready,
      devMode,
      theme,
      quoteSeen,
      avatar,
      signIn,
      signOut,
      setProcess,
      setAvatar,
      toggleTheme,
      markQuoteSeen,
    }),
    [
      user,
      ready,
      devMode,
      theme,
      quoteSeen,
      avatar,
      signIn,
      signOut,
      setProcess,
      setAvatar,
      toggleTheme,
      markQuoteSeen,
    ],
  );

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession() {
  const ctx = useContext(SessionContext);
  if (!ctx) throw new Error("useSession must be used inside SessionProvider");
  return ctx;
}
