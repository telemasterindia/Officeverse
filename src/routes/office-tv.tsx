import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { CelebrationScene } from "@/components/celebration/CelebrationScene";
import { toCelebrationInput } from "@/components/celebration/celebration-visuals";
import {
  useCelebrationCue,
  type InlineAudioSpec,
} from "@/components/celebration/useCelebrationAudio";
import { resolveAudioProfile } from "@/components/celebration/celebration-audio-profiles";
import {
  RotatingScreens,
  TV_SCREENS_CSS,
  type TvScreenData,
} from "@/components/officeverse/tv/tv-screens";

/**
 * Officeverse — Office TV (Phase 21).
 *
 * A dedicated, READ-ONLY, 16:9 live office scoreboard for a large Smart TV.
 * Authenticated ONLY by a display token (never a user session). It polls
 * `GET /api/office-tv/state` (~2.5 s) — no manual refresh, no CRM controls,
 * no lead PII, no salary / HR data.
 *
 * Failure behaviour:
 *   - realtime/poll error  → keep showing the last good leaderboard, retry
 *   - video missing         → fall back to the built-in CSS effect
 *   - photo missing         → initials chip (PhotoDisplay handles it)
 *   - malformed event       → ignored
 *   - token invalid/expired → a calm "reconnect" screen with a token field
 */

export const Route = createFileRoute("/office-tv")({
  head: () => ({ meta: [{ title: "Officeverse Live" }] }),
  component: OfficeTvPage,
});

const POLL_MS = 2500;
const TOKEN_KEY = "ov_tv_token";

type LiveItem = {
  seq: number;
  type: string;
  data: {
    kind: string;
    tier: number;
    effect: string;
    assetId: number | null;
    hasVideo: boolean;
    durationMs: number;
    headline: string | null;
    /* Phase 5 — celebration decision + abstract points (optional) */
    subheadline?: string | null;
    celebrationLevel?: string | null;
    celebrationProfile?: Record<string, unknown> | null;
    points?: number | null;
    subject: {
      userId: number;
      name: string | null;
      role: string | null;
      photoAvailable: boolean;
      /* Phase 6 — data URL of the real official photo, injected by tv-service */
      photo?: string | null;
    } | null;
    /* Phase 10 Stage 2 — a bus "announcement" moment carries these instead */
    announcementId?: number;
    title?: string;
    subtitle?: string | null;
    message?: string;
    priority?: string;
    timeline?: { celebrationAtMs?: number | null } | null;
    audio?: {
      openingSound?: string;
      closingSound?: string;
      ttsEnabled?: boolean;
      tts?: {
        voiceName?: string | null;
        rate: number;
        pitch: number;
        volume: number;
        lang: string;
      };
      spokenText?: string;
    };
    celebration?: Record<string, unknown> | null;
  };
};

type TvState = {
  dbUnavailable?: boolean;
  serverTimeMs: number;
  serverDate: string;
  config: {
    displayName: string;
    rotationSec: number;
    soundEnabled: boolean;
    celebrationIntensity: string;
  };
  window: string;
  leaderboard: {
    rank: number;
    userId: number;
    name: string;
    role: string;
    points: number;
    badge: string | null;
    streak: number;
    photo: string | null;
  }[];
  team: {
    leadsSubmitted: number;
    leadsAccepted: number;
    sales: number;
    teamPoints: number;
    onlineCount: number;
  };
  dailyProduction: {
    userId: number;
    name: string;
    photo: string | null;
    leadsSubmitted: number;
    leadsAccepted: number;
    sales: number;
  }[];
  powerHour: { title: string; message: string } | null;
  teamPhoto: null;
  announcement: {
    id: number;
    title: string;
    subtitle: string | null;
    message: string;
    effect: string | null;
    priority: string;
    durationMs: number;
  } | null;
  live: { latestSeq: number; items: LiveItem[] };
  /* Phase 10 Stage 3 — enriched recent-recognition feed (Recent Achievement screen) */
  recent: {
    id: number;
    kind: string;
    eventLabel: string;
    headline: string;
    level: string | null;
    points: number | null;
    subjectUserId: number | null;
    name: string | null;
    photo: string | null;
    createdAt: string;
  }[];
};

function readInitialToken(): string {
  if (typeof window === "undefined") return "";
  try {
    const url = new URL(window.location.href);
    const q = url.searchParams.get("token");
    if (q) {
      localStorage.setItem(TOKEN_KEY, q);
      url.searchParams.delete("token");
      window.history.replaceState({}, "", url.toString());
      return q;
    }
    return localStorage.getItem(TOKEN_KEY) ?? "";
  } catch {
    return "";
  }
}

function prefersReducedMotion(): boolean {
  if (typeof window === "undefined" || !window.matchMedia) return false;
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

function OfficeTvPage() {
  const [token, setToken] = useState<string>(readInitialToken);
  const [state, setState] = useState<TvState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tokenDraft, setTokenDraft] = useState("");

  // celebration queue + current
  const queueRef = useRef<LiveItem[]>([]);
  const seenSeqRef = useRef<number>(0);
  const [current, setCurrent] = useState<LiveItem | null>(null);
  const playTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const reduced = useMemo(prefersReducedMotion, []);

  const poll = useCallback(async () => {
    if (!token) return;
    try {
      const res = await fetch(
        `/api/office-tv/state?kind=&since=${seenSeqRef.current}&token=${encodeURIComponent(token)}`,
        { headers: { "x-display-token": token } },
      );
      if (res.status === 401 || res.status === 403) {
        setError("token");
        return;
      }
      if (!res.ok) {
        setError("network");
        return;
      }
      const next = (await res.json()) as TvState;
      setError(null);
      setState(next);
      // enqueue any celebration items we have not seen
      for (const item of next.live?.items ?? []) {
        if (
          item.seq > seenSeqRef.current &&
          (item.type === "celebration" || item.type === "announcement") &&
          item.data
        ) {
          queueRef.current.push(item);
        }
      }
      if (next.live?.latestSeq != null) {
        seenSeqRef.current = Math.max(seenSeqRef.current, next.live.latestSeq);
      }
      // cap the local queue so a burst can never grow unbounded
      if (queueRef.current.length > 12) {
        queueRef.current = queueRef.current.slice(-12);
      }
    } catch {
      setError("network"); // keep last good state on screen
    }
  }, [token]);

  // polling loop
  useEffect(() => {
    if (!token) return;
    let alive = true;
    void poll();
    const iv = setInterval(() => {
      if (alive) void poll();
    }, POLL_MS);
    return () => {
      alive = false;
      clearInterval(iv);
    };
  }, [token, poll]);

  // celebration driver — plays one item at a time, then returns to the board
  useEffect(() => {
    if (current) return;
    const iv = setInterval(() => {
      if (current || queueRef.current.length === 0) return;
      const nextItem = queueRef.current.shift()!;
      setCurrent(nextItem);
    }, 400);
    return () => clearInterval(iv);
  }, [current]);

  // Hard safety cap only — the CelebrationScene drives its own timeline and
  // calls onDone() when finished. This guarantees the TV can never wedge on a
  // celebration even if the scene errors.
  useEffect(() => {
    if (!current) return;
    const sceneMs =
      current.type === "announcement"
        ? Number(current.data.durationMs) || 12000
        : toCelebrationInput(current.data, { reduced }).durationMs;
    playTimerRef.current = setTimeout(() => setCurrent(null), sceneMs + (reduced ? 900 : 2600));
    return () => {
      if (playTimerRef.current) clearTimeout(playTimerRef.current);
    };
  }, [current, reduced]);

  // ---- render states ------------------------------------------------------
  if (!token || error === "token") {
    return (
      <TokenGate
        onSubmit={(t) => {
          try {
            localStorage.setItem(TOKEN_KEY, t);
          } catch {
            /* ignore */
          }
          seenSeqRef.current = 0;
          setError(null);
          setToken(t);
        }}
        draft={tokenDraft}
        setDraft={setTokenDraft}
        expired={error === "token"}
      />
    );
  }

  const announcement = state?.announcement ?? null;
  // URGENT persistent announcements INTERRUPT the rotation; NORMAL / IMPORTANT
  // ones ride along on the rotation's hero screen (never a permanent takeover).
  const urgentAnnouncement =
    announcement && announcement.priority === "URGENT" ? announcement : null;
  const interrupted = !!current || !!urgentAnnouncement;

  const screenData: TvScreenData = {
    displayName: state?.config.displayName ?? "OFFICEVERSE LIVE",
    serverDate: state?.serverDate ?? "",
    window: state?.window ?? "daily",
    leaderboard: state?.leaderboard ?? [],
    recent: state?.recent ?? [],
    team: state?.team ?? null,
    dailyProduction: state?.dailyProduction ?? [],
    powerHour: state?.powerHour ?? null,
    announcement:
      announcement && announcement.priority !== "URGENT"
        ? {
            title: announcement.title,
            subtitle: announcement.subtitle,
            message: announcement.message,
          }
        : null,
    dbUnavailable: !!state?.dbUnavailable,
    reconnecting: error === "network",
  };
  const rotationMs = (state?.config.rotationSec ?? 12) * 1000;

  return (
    <div style={SHELL}>
      <style>{TV_CSS + TV_SCREENS_CSS}</style>
      {urgentAnnouncement ? (
        <AnnouncementView a={urgentAnnouncement} />
      ) : current && current.type === "announcement" ? (
        <AnnouncementMomentView
          key={current.seq}
          data={current.data}
          reduced={reduced}
          soundEnabled={state?.config.soundEnabled ?? false}
          onDone={() => setCurrent(null)}
        />
      ) : current ? (
        <CelebrationView
          key={current.seq}
          item={current}
          reduced={reduced}
          soundEnabled={state?.config.soundEnabled ?? false}
          onDone={() => setCurrent(null)}
        />
      ) : null}
      {/* the rotation always stays mounted so its single timer never restarts on
          an interrupt — it is just visually covered + `paused` while one runs */}
      <div style={interrupted ? HIDDEN : undefined} aria-hidden={interrupted}>
        <RotatingScreens data={screenData} rotationMs={rotationMs} paused={interrupted} />
      </div>
    </div>
  );
}

/* ------------------------------- views -------------------------------- */

/**
 * Phase 6 — the cinematic IPL-style celebration. Consumes the Phase-5
 * `recognitionBus "celebration"` payload only; all visuals live in
 * `src/components/celebration/*`. It never fetches, mutates or computes
 * anything. The scene owns its own 3–5 s timeline and calls `onDone`.
 */
function CelebrationView({
  item,
  reduced,
  soundEnabled,
  onDone,
}: {
  item: LiveItem;
  reduced: boolean;
  soundEnabled: boolean;
  onDone: () => void;
}) {
  const input = useMemo(() => toCelebrationInput(item.data, { reduced }), [item.data, reduced]);
  return (
    <CelebrationScene input={input} reduced={reduced} soundEnabled={soundEnabled} onDone={onDone} />
  );
}

function AnnouncementView({ a }: { a: NonNullable<TvState["announcement"]> }) {
  return (
    <div className={`tv-announce prio-${a.priority.toLowerCase()}`}>
      <div className={`tv-fx fx-${(a.effect ?? "celebration").toLowerCase()}`} aria-hidden />
      <div className="tv-announce-inner">
        <div className="tv-announce-tag">{a.priority === "URGENT" ? "URGENT" : "ANNOUNCEMENT"}</div>
        <h1 className="tv-announce-title">{a.title}</h1>
        {a.subtitle ? <div className="tv-announce-sub">{a.subtitle}</div> : null}
        <p className="tv-announce-msg">{a.message}</p>
      </div>
    </div>
  );
}

/**
 * Phase 10 Stage 2 — a bus `"announcement"` MOMENT (from Operations → Play on
 * TV, or a Power Hour start). Reuses the AnnouncementView chrome + the shared
 * `useCelebrationCue` audio engine with an EXACT inline spec (opening cue →
 * short pause → TTS → optional celebration → closing cue). No fetch, no
 * mutation, no scoring. Every timer/audio node is cleaned up on unmount.
 */
function AnnouncementMomentView({
  data,
  reduced,
  soundEnabled,
  onDone,
}: {
  data: LiveItem["data"];
  reduced: boolean;
  soundEnabled: boolean;
  onDone: () => void;
}) {
  const dur = Number(data.durationMs) || 12000;
  const audio = data.audio ?? {};
  const spec: InlineAudioSpec = {
    openingSound: (audio.openingSound as InlineAudioSpec["openingSound"]) ?? "none",
    closingSound: (audio.closingSound as InlineAudioSpec["closingSound"]) ?? "none",
    tts: audio.tts ?? { voiceName: null, rate: 1, pitch: 1, volume: 1, lang: "en-US" },
  };
  useCelebrationCue({
    profile: resolveAudioProfile("silent"),
    announcement: audio.ttsEnabled ? (audio.spokenText ?? "") : "",
    soundEnabled,
    reduced,
    durationMs: dur,
    inlineSpec: spec,
  });

  // hard safety — always release the screen even if nothing else fires
  useEffect(() => {
    const t = setTimeout(onDone, dur + 800);
    return () => clearTimeout(t);
  }, [dur, onDone]);

  // optional mid-sequence celebration
  const [showCeleb, setShowCeleb] = useState(false);
  useEffect(() => {
    const at = data.timeline?.celebrationAtMs;
    if (!data.celebration || typeof at !== "number") return;
    const t = setTimeout(() => setShowCeleb(true), Math.max(0, at));
    return () => clearTimeout(t);
  }, [data]);

  const priority = String(data.priority ?? "NORMAL");
  return (
    <div className={`tv-announce prio-${priority.toLowerCase()}`}>
      <div
        className={`tv-fx fx-${String(data.effect ?? "celebration").toLowerCase()}`}
        aria-hidden
      />
      <div className="tv-announce-inner">
        <div className="tv-announce-tag">{priority === "URGENT" ? "URGENT" : "ANNOUNCEMENT"}</div>
        <h1 className="tv-announce-title">{data.title}</h1>
        {data.subtitle ? <div className="tv-announce-sub">{data.subtitle}</div> : null}
        <p className="tv-announce-msg">{data.message}</p>
      </div>
      {showCeleb && data.celebration ? (
        <div style={{ position: "absolute", inset: 0 }}>
          <CelebrationScene
            input={toCelebrationInput(
              {
                celebrationLevel: data.celebration["level"],
                celebrationProfile: data.celebration,
              },
              { reduced },
            )}
            reduced={reduced}
            soundEnabled={false}
            onDone={() => setShowCeleb(false)}
          />
        </div>
      ) : null}
    </div>
  );
}

function TokenGate({
  onSubmit,
  draft,
  setDraft,
  expired,
}: {
  onSubmit: (t: string) => void;
  draft: string;
  setDraft: (s: string) => void;
  expired: boolean;
}) {
  return (
    <div style={SHELL}>
      <style>{TV_CSS}</style>
      <div className="tv-gate">
        <div className="tv-brand">OFFICEVERSE LIVE</div>
        <p className="tv-gate-msg">
          {expired
            ? "This display token is invalid or was revoked. Enter a current token."
            : "Enter the display token created by an Admin (Live Office → Displays)."}
        </p>
        <form
          className="tv-gate-form"
          onSubmit={(e) => {
            e.preventDefault();
            if (draft.trim().length >= 16) onSubmit(draft.trim());
          }}
        >
          <input
            className="tv-gate-input"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder="ovtv_…"
            autoComplete="off"
            spellCheck={false}
          />
          <button className="tv-gate-btn" type="submit">
            Connect
          </button>
        </form>
      </div>
    </div>
  );
}

/* ------------------------------ helpers ------------------------------- */

const SHELL: React.CSSProperties = {
  position: "fixed",
  inset: 0,
  background: "#070b18",
  color: "#f4f6ff",
  overflow: "hidden",
};

/** keeps the rotation mounted (single timer) but out of sight during an interrupt */
const HIDDEN: React.CSSProperties = { position: "absolute", inset: 0, visibility: "hidden" };

const TV_CSS = `
.tv-board,.tv-celebrate,.tv-announce,.tv-gate{position:absolute;inset:0;display:flex;flex-direction:column}
.tv-board{padding:3.5vh 4vw;gap:2.4vh}
.tv-head{display:flex;flex-direction:column;gap:.4vh}
.tv-brand{font-weight:900;letter-spacing:.12em;font-size:min(6vw,5.2vh);
  background:linear-gradient(90deg,#4c8dff,#9cc4ff);-webkit-background-clip:text;background-clip:text;color:transparent}
.tv-sub{font-size:min(2.4vw,2.4vh);color:#9fb0d9;text-transform:uppercase;letter-spacing:.16em}
.tv-dot{display:inline-block;width:.9vh;height:.9vh;margin-left:1vw;border-radius:999px;background:#4c8dff;animation:tvpulse 1.2s infinite}
@keyframes tvpulse{50%{opacity:.25}}
.tv-list{list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:1.3vh;flex:1}
.tv-row{display:grid;grid-template-columns:min(7vw,7vh) min(11vw,12vh) 1fr auto;align-items:center;gap:2vw;
  background:rgba(255,255,255,.045);border:1px solid rgba(255,255,255,.06);border-radius:2vh;padding:1.4vh 2vw}
.tv-row.rank-1{background:linear-gradient(90deg,rgba(76,141,255,.24),rgba(76,141,255,.05));border-color:rgba(76,141,255,.45)}
.tv-row.rank-2{background:rgba(203,213,225,.12)}
.tv-row.rank-3{background:rgba(148,163,184,.14)}
.tv-rank{font-weight:900;font-size:min(5vw,5vh);color:#8ea3d6;text-align:center}
.tv-photo{display:flex;justify-content:center}
.tv-name{font-weight:800;font-size:min(4vw,4.6vh);display:flex;align-items:center;gap:1.4vw}
.tv-streak{font-size:min(2.2vw,2.4vh);color:#7db4ff;font-weight:700}
.tv-points{font-weight:900;font-size:min(5vw,5.6vh);color:#7CF5C4}
.tv-points small{font-size:.4em;color:#9fb0d9;margin-left:.4vw}
.tv-stats{display:grid;grid-template-columns:repeat(5,1fr);gap:2vw}
.tv-stat{background:rgba(255,255,255,.05);border-radius:1.6vh;padding:1.6vh 1vw;text-align:center}
.tv-stat-n{font-weight:900;font-size:min(4.4vw,4.6vh)}
.tv-stat-l{font-size:min(1.8vw,1.9vh);color:#9fb0d9;text-transform:uppercase;letter-spacing:.14em;margin-top:.5vh}
.tv-empty{flex:1;display:flex;align-items:center;justify-content:center;font-size:min(3.4vw,3.6vh);color:#9fb0d9;text-align:center}
.tv-celebrate,.tv-announce{align-items:center;justify-content:center;text-align:center}
.tv-video{position:absolute;inset:0;width:100%;height:100%;object-fit:cover;opacity:.5}
.tv-fx{position:absolute;inset:0;background:radial-gradient(circle at 50% 40%,rgba(76,141,255,.3),transparent 60%)}
.fx-money{background:radial-gradient(circle at 50% 45%,rgba(124,245,196,.3),transparent 62%)}
.fx-victory,.fx-champion{background:radial-gradient(circle at 50% 40%,rgba(76,141,255,.36),transparent 60%)}
.fx-festival{background:radial-gradient(circle at 50% 40%,rgba(124,138,255,.3),transparent 62%)}
.tv-celebrate-inner,.tv-announce-inner{position:relative;display:flex;flex-direction:column;align-items:center;gap:2.2vh;padding:0 6vw}
.tv-celebrate-name{font-weight:900;font-size:min(9vw,10vh)}
.tv-celebrate-head{font-weight:900;font-size:min(7vw,8vh);letter-spacing:.05em;
  background:linear-gradient(90deg,#4c8dff,#9cc4ff);-webkit-background-clip:text;background-clip:text;color:transparent}
.tv-celebrate-kind{font-size:min(3vw,3.2vh);color:#9fb0d9;text-transform:uppercase;letter-spacing:.24em}
.tier-4 .tv-celebrate-head{font-size:min(8.5vw,9.5vh)}
.tv-announce-tag{font-size:min(2.6vw,2.8vh);letter-spacing:.3em;color:#7db4ff}
.tv-announce.prio-urgent .tv-announce-tag{color:#ff6b6b}
.tv-announce-title{font-weight:900;font-size:min(8vw,9vh);margin:1vh 0}
.tv-announce-sub{font-size:min(3.6vw,3.8vh);color:#c7d3f2}
.tv-announce-msg{font-size:min(3vw,3.2vh);color:#9fb0d9;max-width:70vw;margin:2vh auto 0}
.tv-gate{align-items:center;justify-content:center;gap:3vh;text-align:center;padding:0 8vw}
.tv-gate-msg{font-size:min(2.6vw,2.8vh);color:#9fb0d9;max-width:60vw}
.tv-gate-form{display:flex;gap:1.5vw}
.tv-gate-input{font-size:min(2.6vw,2.8vh);padding:1.6vh 2vw;border-radius:1.4vh;border:1px solid rgba(255,255,255,.2);
  background:rgba(255,255,255,.06);color:#fff;min-width:44vw}
.tv-gate-btn{font-size:min(2.6vw,2.8vh);padding:1.6vh 3vw;border-radius:1.4vh;border:0;font-weight:800;
  background:linear-gradient(90deg,#3b7bef,#5b9bff);color:#fff;cursor:pointer}
@media (prefers-reduced-motion: reduce){.tv-dot{animation:none}}
`;
