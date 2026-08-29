import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { avatarFromSeed, normalizeAvatar } from "./avatar";
import { DEMO_USERS } from "./data";
import type { AvatarConfig, ProcessCode, Role, SessionUser } from "./types";

const STORAGE_KEY = "officeverse.session";
const QUOTE_KEY = "officeverse.quoteShown";
const THEME_KEY = "officeverse.theme";
const AVATAR_KEY = "officeverse.avatar";

type Theme = "dark" | "light";

interface SessionState {
  user: SessionUser | null;
  ready: boolean;
  theme: Theme;
  quoteSeen: boolean;
  /** Current user's illustrated character config (derived + persisted client-side). */
  avatar: AvatarConfig | null;
  signIn: (role: Role, process?: ProcessCode) => void;
  signOut: () => void;
  setProcess: (p: ProcessCode) => void;
  setAvatar: (config: AvatarConfig) => void;
  toggleTheme: () => void;
  markQuoteSeen: () => void;
}

const SessionContext = createContext<SessionState | null>(null);

function todayKey() {
  return new Date().toISOString().slice(0, 10);
}

export function SessionProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<SessionUser | null>(null);
  const [ready, setReady] = useState(false);
  const [theme, setTheme] = useState<Theme>("light");
  const [quoteSeen, setQuoteSeen] = useState(true);
  const [avatarMap, setAvatarMap] = useState<Record<string, AvatarConfig>>({});

  useEffect(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) setUser(JSON.parse(raw) as SessionUser);
      const t = (localStorage.getItem(THEME_KEY) as Theme | null) ?? "light";
      setTheme(t);
      setQuoteSeen(localStorage.getItem(QUOTE_KEY) === todayKey());
      const am = localStorage.getItem(AVATAR_KEY);
      if (am) {
        const parsed = JSON.parse(am);
        if (parsed && typeof parsed === "object")
          setAvatarMap(parsed as Record<string, AvatarConfig>);
      }
    } catch {
      /* ignore */
    }
    setReady(true);
  }, []);

  useEffect(() => {
    const root = document.documentElement;
    root.classList.toggle("light", theme === "light");
    root.classList.toggle("dark", theme === "dark");
  }, [theme]);

  const signIn = useCallback((role: Role, process?: ProcessCode) => {
    const next = { ...DEMO_USERS[role], ...(process ? { process } : {}) };
    setUser(next);
    setQuoteSeen(false);
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
      localStorage.removeItem(QUOTE_KEY);
    } catch {
      /* ignore */
    }
  }, []);

  const signOut = useCallback(() => {
    setUser(null);
    try {
      localStorage.removeItem(STORAGE_KEY);
    } catch {
      /* ignore */
    }
  }, []);

  const setProcess = useCallback((p: ProcessCode) => {
    setUser((prev) => {
      if (!prev) return prev;
      const next = { ...prev, process: p };
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
      } catch {
        /* ignore */
      }
      return next;
    });
  }, []);

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

  const value = useMemo(
    () => ({
      user,
      ready,
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
