import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { PhotoDisplay } from "@/components/officeverse/photo/PhotoDisplay";

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
    subject: {
      userId: number;
      name: string | null;
      role: string | null;
      photoAvailable: boolean;
    } | null;
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
  recent: { kind: string; message: string | null; tier: number; createdAt: string }[];
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
        if (item.seq > seenSeqRef.current && item.type === "celebration" && item.data) {
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

  useEffect(() => {
    if (!current) return;
    const ms = reduced ? 2200 : Math.max(2500, Math.min(15000, current.data.durationMs || 6000));
    playTimerRef.current = setTimeout(() => setCurrent(null), ms);
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
  const showAnnouncement = announcement && (!current || announcement.priority === "URGENT");

  return (
    <div style={SHELL}>
      <style>{TV_CSS}</style>
      {showAnnouncement ? (
        <AnnouncementView a={announcement!} />
      ) : current ? (
        <CelebrationView item={current} token={token} reduced={reduced} />
      ) : (
        <BoardView state={state} error={error} />
      )}
    </div>
  );
}

/* ------------------------------- views -------------------------------- */

function BoardView({ state, error }: { state: TvState | null; error: string | null }) {
  const rows = state?.leaderboard ?? [];
  const team = state?.team;
  return (
    <div className="tv-board">
      <header className="tv-head">
        <div className="tv-brand">{state?.config.displayName ?? "OFFICEVERSE LIVE"}</div>
        <div className="tv-sub">
          {state ? `${labelFor(state.window)} leaderboard · ${state.serverDate}` : "Connecting…"}
          {error === "network" ? <span className="tv-dot" title="reconnecting" /> : null}
        </div>
      </header>

      {rows.length === 0 ? (
        <div className="tv-empty">
          {state?.dbUnavailable
            ? "Waiting for the database…"
            : "No points yet today — the board fills as the team works."}
        </div>
      ) : (
        <ol className="tv-list">
          {rows.slice(0, 8).map((r) => (
            <li key={r.userId} className={`tv-row rank-${r.rank <= 3 ? r.rank : "n"}`}>
              <span className="tv-rank">{r.rank}</span>
              <span className="tv-photo">
                <PhotoDisplay
                  name={r.name}
                  src={r.photo}
                  size="lg"
                  {...(r.rank <= 3 ? { rank: r.rank } : {})}
                  {...(r.badge ? { badge: r.badge } : {})}
                />
              </span>
              <span className="tv-name">
                {r.name}
                {r.streak > 0 ? <span className="tv-streak">🔥 {r.streak}d</span> : null}
              </span>
              <span className="tv-points">
                {r.points}
                <small>pts</small>
              </span>
            </li>
          ))}
        </ol>
      )}

      {team ? (
        <footer className="tv-stats">
          <Stat n={team.leadsSubmitted} label="Submitted" />
          <Stat n={team.leadsAccepted} label="Accepted" />
          <Stat n={team.sales} label="Sales" />
          <Stat n={team.teamPoints} label="Team points" />
          <Stat n={team.onlineCount} label="Online" />
        </footer>
      ) : null}
    </div>
  );
}

function Stat({ n, label }: { n: number; label: string }) {
  return (
    <div className="tv-stat">
      <div className="tv-stat-n">{n}</div>
      <div className="tv-stat-l">{label}</div>
    </div>
  );
}

function CelebrationView({
  item,
  token,
  reduced,
}: {
  item: LiveItem;
  token: string;
  reduced: boolean;
}) {
  const d = item.data;
  const [videoFailed, setVideoFailed] = useState(false);
  const showVideo = d.hasVideo && d.assetId != null && !videoFailed && !reduced;

  return (
    <div className={`tv-celebrate tier-${d.tier}`}>
      {showVideo ? (
        <video
          className="tv-video"
          autoPlay
          muted
          playsInline
          onError={() => setVideoFailed(true)}
          src={`/api/office-tv/asset?id=${d.assetId}&token=${encodeURIComponent(token)}`}
        />
      ) : (
        <div className={`tv-fx fx-${d.effect.toLowerCase()}`} aria-hidden />
      )}

      <div className="tv-celebrate-inner">
        {d.subject ? (
          <PhotoDisplay
            name={d.subject.name ?? "Officeverse"}
            src={null}
            size="2xl"
            effect={reduced ? null : d.effect}
            effectBurstMs={reduced ? 0 : Math.min(6000, d.durationMs)}
          />
        ) : null}
        {d.subject?.name ? <div className="tv-celebrate-name">{d.subject.name}</div> : null}
        <div className="tv-celebrate-head">{d.headline ?? kindLabel(d.kind)}</div>
        <div className="tv-celebrate-kind">{kindLabel(d.kind)}</div>
      </div>
    </div>
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

function labelFor(w: string): string {
  return w === "alltime" ? "All-time" : w.charAt(0).toUpperCase() + w.slice(1);
}
function kindLabel(k: string): string {
  return (
    {
      LEAD_SUBMITTED: "LEAD SUBMITTED",
      LEAD_ACCEPTED: "LEAD ACCEPTED",
      THIRD_ACCEPTED_LEAD: "ON FIRE",
      SALE: "SALE",
      ACHIEVEMENT_UNLOCKED: "ACHIEVEMENT",
      TEAM_MILESTONE: "TEAM MILESTONE",
    }[k] ?? k.replace(/_/g, " ")
  );
}

const SHELL: React.CSSProperties = {
  position: "fixed",
  inset: 0,
  background: "#070b18",
  color: "#f4f6ff",
  overflow: "hidden",
};

const TV_CSS = `
.tv-board,.tv-celebrate,.tv-announce,.tv-gate{position:absolute;inset:0;display:flex;flex-direction:column}
.tv-board{padding:3.5vh 4vw;gap:2.4vh}
.tv-head{display:flex;flex-direction:column;gap:.4vh}
.tv-brand{font-weight:900;letter-spacing:.12em;font-size:min(6vw,5.2vh);
  background:linear-gradient(90deg,#ffd76b,#ff7a59);-webkit-background-clip:text;background-clip:text;color:transparent}
.tv-sub{font-size:min(2.4vw,2.4vh);color:#9fb0d9;text-transform:uppercase;letter-spacing:.16em}
.tv-dot{display:inline-block;width:.9vh;height:.9vh;margin-left:1vw;border-radius:999px;background:#ffb020;animation:tvpulse 1.2s infinite}
@keyframes tvpulse{50%{opacity:.25}}
.tv-list{list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:1.3vh;flex:1}
.tv-row{display:grid;grid-template-columns:min(7vw,7vh) min(11vw,12vh) 1fr auto;align-items:center;gap:2vw;
  background:rgba(255,255,255,.045);border:1px solid rgba(255,255,255,.06);border-radius:2vh;padding:1.4vh 2vw}
.tv-row.rank-1{background:linear-gradient(90deg,rgba(255,215,107,.22),rgba(255,215,107,.05));border-color:rgba(255,215,107,.4)}
.tv-row.rank-2{background:rgba(203,213,225,.12)}
.tv-row.rank-3{background:rgba(205,127,50,.14)}
.tv-rank{font-weight:900;font-size:min(5vw,5vh);color:#8ea3d6;text-align:center}
.tv-photo{display:flex;justify-content:center}
.tv-name{font-weight:800;font-size:min(4vw,4.6vh);display:flex;align-items:center;gap:1.4vw}
.tv-streak{font-size:min(2.2vw,2.4vh);color:#ffb86b;font-weight:700}
.tv-points{font-weight:900;font-size:min(5vw,5.6vh);color:#7CF5C4}
.tv-points small{font-size:.4em;color:#9fb0d9;margin-left:.4vw}
.tv-stats{display:grid;grid-template-columns:repeat(5,1fr);gap:2vw}
.tv-stat{background:rgba(255,255,255,.05);border-radius:1.6vh;padding:1.6vh 1vw;text-align:center}
.tv-stat-n{font-weight:900;font-size:min(4.4vw,4.6vh)}
.tv-stat-l{font-size:min(1.8vw,1.9vh);color:#9fb0d9;text-transform:uppercase;letter-spacing:.14em;margin-top:.5vh}
.tv-empty{flex:1;display:flex;align-items:center;justify-content:center;font-size:min(3.4vw,3.6vh);color:#9fb0d9;text-align:center}
.tv-celebrate,.tv-announce{align-items:center;justify-content:center;text-align:center}
.tv-video{position:absolute;inset:0;width:100%;height:100%;object-fit:cover;opacity:.5}
.tv-fx{position:absolute;inset:0;background:radial-gradient(circle at 50% 40%,rgba(255,215,107,.28),transparent 60%)}
.fx-money{background:radial-gradient(circle at 50% 45%,rgba(124,245,196,.3),transparent 62%)}
.fx-victory,.fx-champion{background:radial-gradient(circle at 50% 40%,rgba(255,215,107,.34),transparent 60%)}
.fx-festival{background:radial-gradient(circle at 50% 40%,rgba(255,122,89,.3),transparent 62%)}
.tv-celebrate-inner,.tv-announce-inner{position:relative;display:flex;flex-direction:column;align-items:center;gap:2.2vh;padding:0 6vw}
.tv-celebrate-name{font-weight:900;font-size:min(9vw,10vh)}
.tv-celebrate-head{font-weight:900;font-size:min(7vw,8vh);letter-spacing:.05em;
  background:linear-gradient(90deg,#ffd76b,#ff7a59);-webkit-background-clip:text;background-clip:text;color:transparent}
.tv-celebrate-kind{font-size:min(3vw,3.2vh);color:#9fb0d9;text-transform:uppercase;letter-spacing:.24em}
.tier-4 .tv-celebrate-head{font-size:min(8.5vw,9.5vh)}
.tv-announce-tag{font-size:min(2.6vw,2.8vh);letter-spacing:.3em;color:#ffb86b}
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
  background:linear-gradient(90deg,#ffd76b,#ff7a59);color:#231400;cursor:pointer}
@media (prefers-reduced-motion: reduce){.tv-dot{animation:none}}
`;
