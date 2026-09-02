/**
 * Officeverse — OFFICE TV rotation SCREENS (Phase 10 Stage 3).
 *
 * Full-screen, distance-readable information screens for the rotating Office TV.
 * PRESENTATION ONLY: every screen receives already-resolved data as props —
 * it never fetches, never ranks, never aggregates points, never imports a
 * client `*-fns` module. The leaderboard rows come straight from the
 * authoritative Phase-8 representation delivered by `GET /api/office-tv/state`.
 *
 * `RotatingScreens` wires `buildRotationScreens` + the single `useTvRotation`
 * hook and renders the current screen. Announcements / celebrations are handled
 * by `office-tv.tsx` as interrupts and pass `paused` here.
 */
import { PhotoDisplay } from "@/components/officeverse/photo/PhotoDisplay";
import { buildRotationScreens, windowLabel } from "./tv-rotation";
import { useTvRotation } from "./useTvRotation";

export interface TvLeaderRow {
  rank: number;
  userId: number;
  name: string;
  points: number;
  badge: string | null;
  streak: number;
  photo: string | null;
}

export interface TvRecentItem {
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
}

export interface TvTeam {
  leadsSubmitted: number;
  leadsAccepted: number;
  sales: number;
  teamPoints: number;
  onlineCount: number;
}

export interface TvProductionRow {
  userId: number;
  name: string;
  photo: string | null;
  leadsSubmitted: number;
  leadsAccepted: number;
  sales: number;
}

export interface TvScreenData {
  displayName: string;
  serverDate: string;
  window: string;
  leaderboard: TvLeaderRow[];
  recent: TvRecentItem[];
  team: TvTeam | null;
  /** Stage 5 — "Today's Production" rows (agents only), from the authoritative
   *  per-agent aggregation. NOT the leaderboard. */
  dailyProduction: TvProductionRow[];
  /** Stage 5 — the active Power Hour (existing announcement, effect POWERHOUR). */
  powerHour: { title: string; message: string } | null;
  /** a NORMAL / IMPORTANT persistent announcement — shown ON the hero screen
   *  (URGENT is an interrupt handled by office-tv.tsx, never routed here) */
  announcement: { title: string; subtitle: string | null; message: string } | null;
  dbUnavailable: boolean;
  reconnecting: boolean;
}

const MEDAL = ["🥇", "🥈", "🥉"];

function fmtWhen(iso: string): string {
  const t = iso.replace("T", " ").slice(11, 16);
  return t || iso.slice(0, 10);
}

/* -------------------------------- hero -------------------------------- */

export function HeroScreen({ data }: { data: TvScreenData }) {
  const t = data.team;
  const a = data.announcement;
  return (
    <div className="tvs tvs-hero">
      <div className="tvs-hero-brand">{data.displayName || "OFFICEVERSE LIVE"}</div>
      <div className="tvs-hero-date">
        {data.serverDate}
        {data.reconnecting ? <span className="tvs-dot" title="reconnecting" /> : null}
      </div>
      {a ? (
        <div className="tvs-hero-ann">
          <div className="tvs-hero-ann-tag">ANNOUNCEMENT</div>
          <div className="tvs-hero-ann-title">{a.title}</div>
          {a.subtitle ? <div className="tvs-hero-ann-sub">{a.subtitle}</div> : null}
          <div className="tvs-hero-ann-msg">{a.message}</div>
        </div>
      ) : (
        <div className="tvs-hero-tag">TEAM PERFORMANCE · LIVE</div>
      )}
      {t ? (
        <div className="tvs-hero-stats">
          <Stat n={t.leadsSubmitted} label="Submitted" />
          <Stat n={t.leadsAccepted} label="Accepted" />
          <Stat n={t.sales} label="Sales" />
          <Stat n={t.teamPoints} label="Team points" />
          <Stat n={t.onlineCount} label="Online" />
        </div>
      ) : null}
    </div>
  );
}

function Stat({ n, label }: { n: number; label: string }) {
  return (
    <div className="tvs-stat">
      <div className="tvs-stat-n">{n.toLocaleString()}</div>
      <div className="tvs-stat-l">{label}</div>
    </div>
  );
}

/* ----------------------------- leaderboard --------------------------- */

export function LeaderboardScreen({ data }: { data: TvScreenData }) {
  const rows = data.leaderboard.slice(0, 8);
  if (rows.length === 0) {
    return (
      <div className="tvs tvs-lb">
        <div className="tvs-lb-head">{windowLabel(data.window)} LEADERBOARD</div>
        <div className="tvs-empty">
          {data.dbUnavailable
            ? "Leaderboard temporarily unavailable"
            : "No points yet — the board fills as the team works."}
        </div>
      </div>
    );
  }
  return (
    <div className="tvs tvs-lb">
      <div className="tvs-lb-head">{windowLabel(data.window)} LEADERBOARD</div>
      <ol className="tvs-lb-list">
        {rows.map((r) => (
          <li key={r.userId} className={`tvs-lb-row r${r.rank <= 3 ? r.rank : "n"}`}>
            <span className="tvs-lb-rank">{r.rank <= 3 ? MEDAL[r.rank - 1] : r.rank}</span>
            <span className="tvs-lb-photo">
              <PhotoDisplay
                name={r.name}
                src={r.photo}
                size="lg"
                {...(r.rank <= 3 ? { rank: r.rank } : {})}
                {...(r.badge ? { badge: r.badge } : {})}
              />
            </span>
            <span className="tvs-lb-name">
              {r.name}
              {r.streak > 0 ? <span className="tvs-lb-streak">🔥 {r.streak}d</span> : null}
            </span>
            <span className="tvs-lb-pts">
              {r.points.toLocaleString()}
              <small>POINTS</small>
            </span>
          </li>
        ))}
      </ol>
    </div>
  );
}

/* -------------------------- recent achievement ---------------------- */

export function RecentAchievementScreen({ data }: { data: TvScreenData }) {
  const item = data.recent[0];
  if (!item) {
    // parent skips this screen when the feed is empty; this is a defensive guard
    return (
      <div className="tvs tvs-ach">
        <div className="tvs-ach-tag">RECENT ACHIEVEMENT</div>
        <div className="tvs-empty">No recent recognition yet.</div>
      </div>
    );
  }
  return (
    <div className="tvs tvs-ach">
      <div className="tvs-ach-tag">RECENT ACHIEVEMENT</div>
      <div className="tvs-ach-photo">
        <PhotoDisplay name={item.name ?? "Officeverse"} src={item.photo} size="lg" />
      </div>
      {item.name ? <div className="tvs-ach-name">{item.name}</div> : null}
      <div className="tvs-ach-head">{item.headline || item.eventLabel}</div>
      <div className="tvs-ach-meta">
        {item.level ? <span className="tvs-ach-chip">{item.level.replace("_", " ")}</span> : null}
        {typeof item.points === "number" && item.points > 0 ? (
          <span className="tvs-ach-pts">+{item.points.toLocaleString()} POINTS</span>
        ) : null}
        <span className="tvs-ach-when">{fmtWhen(item.createdAt)}</span>
      </div>
    </div>
  );
}

/* ------------------------- daily production ----------------------- */

/**
 * Stage 5 — "TODAY'S PRODUCTION". Actual work completed today per agent
 * (submitted / accepted / sales). NOT points, NOT ranking — a sales-floor
 * production board. Big names, big numbers, readable from across the room.
 */
export function DailyProductionScreen({ data }: { data: TvScreenData }) {
  const rows = data.dailyProduction.slice(0, 8);
  return (
    <div className="tvs tvs-prod">
      <div className="tvs-prod-head">TODAY&apos;S PRODUCTION</div>
      {rows.length === 0 ? (
        <div className="tvs-empty">No production logged yet today.</div>
      ) : (
        <ol className="tvs-prod-list">
          {rows.map((r) => (
            <li key={r.userId} className="tvs-prod-row">
              <span className="tvs-prod-photo">
                <PhotoDisplay name={r.name} src={r.photo} size="lg" />
              </span>
              <span className="tvs-prod-name">{r.name}</span>
              <span className="tvs-prod-nums">
                <span className="tvs-prod-n">
                  <b>{r.leadsSubmitted}</b>
                  <em>{r.leadsSubmitted === 1 ? "LEAD" : "LEADS"}</em>
                </span>
                <span className="tvs-prod-n">
                  <b>{r.leadsAccepted}</b>
                  <em>ACCEPTED</em>
                </span>
                <span className="tvs-prod-n">
                  <b>{r.sales}</b>
                  <em>{r.sales === 1 ? "SALE" : "SALES"}</em>
                </span>
              </span>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}

/* ----------------------------- power hour ------------------------- */

export function PowerHourScreen({ data }: { data: TvScreenData }) {
  const p = data.powerHour;
  return (
    <div className="tvs tvs-ph">
      <div className="tvs-ph-tag">POWER HOUR · LIVE</div>
      <div className="tvs-ph-title">{p?.title || "POWER HOUR"}</div>
      {p?.message ? <div className="tvs-ph-msg">{p.message}</div> : null}
    </div>
  );
}

/* ------------------------- the rotation host ----------------------- */

export function RotatingScreens({
  data,
  rotationMs,
  paused,
}: {
  data: TvScreenData;
  /** dwell per screen = office_tv_settings.rotationSec * 1000 */
  rotationMs: number;
  /** an announcement / celebration interrupt is on screen — hold rotation */
  paused: boolean;
}) {
  const screens = buildRotationScreens({
    hasDailyProduction: data.dailyProduction.length > 0,
    hasLeaderboard: data.leaderboard.length > 0 || data.dbUnavailable,
    hasTeamPhoto: false, // no team-photo configuration exists in the product
    hasPowerHour: data.powerHour != null,
    hasAchievement: data.recent.length > 0,
  });
  const { screen } = useTvRotation({ screens, rotationMs, paused });
  return renderScreen(screen?.kind ?? "HERO", data);
}

function renderScreen(kind: string, data: TvScreenData) {
  switch (kind) {
    case "DAILY_PRODUCTION":
      return <DailyProductionScreen data={data} />;
    case "LEADERBOARD":
      return <LeaderboardScreen data={data} />;
    case "POWER_HOUR":
      return <PowerHourScreen data={data} />;
    case "RECENT_ACHIEVEMENT":
      return <RecentAchievementScreen data={data} />;
    default:
      return <HeroScreen data={data} />;
  }
}

export const TV_SCREENS_CSS = `
.tvs{position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;
  text-align:center;padding:5vh 5vw;gap:3vh}
.tvs-dot{display:inline-block;width:.9vh;height:.9vh;margin-left:1vw;border-radius:999px;background:#4c8dff;animation:tvpulse 1.2s infinite}
.tvs-empty{font-size:min(3.6vw,3.8vh);color:#9fb0d9}

.tvs-hero{gap:2.4vh}
.tvs-hero-brand{font-weight:900;letter-spacing:.12em;font-size:min(7vw,7vh);
  background:linear-gradient(90deg,#4c8dff,#9cc4ff);-webkit-background-clip:text;background-clip:text;color:transparent}
.tvs-hero-date{font-size:min(2.6vw,2.8vh);color:#9fb0d9;text-transform:uppercase;letter-spacing:.2em}
.tvs-hero-tag{font-size:min(2.4vw,2.6vh);color:#8fbcff;text-transform:uppercase;letter-spacing:.35em;font-weight:800}
.tvs-hero-ann{max-width:78vw;display:flex;flex-direction:column;gap:1.2vh}
.tvs-hero-ann-tag{font-size:min(2.2vw,2.4vh);letter-spacing:.3em;color:#7db4ff}
.tvs-hero-ann-title{font-weight:900;font-size:min(6vw,7vh)}
.tvs-hero-ann-sub{font-size:min(3vw,3.2vh);color:#c7d3f2}
.tvs-hero-ann-msg{font-size:min(2.6vw,2.8vh);color:#9fb0d9}
.tvs-hero-stats{display:grid;grid-template-columns:repeat(5,1fr);gap:2vw;width:86vw;margin-top:1vh}
.tvs-stat{background:rgba(255,255,255,.05);border-radius:1.6vh;padding:1.8vh 1vw}
.tvs-stat-n{font-weight:900;font-size:min(4.4vw,4.6vh)}
.tvs-stat-l{font-size:min(1.8vw,1.9vh);color:#9fb0d9;text-transform:uppercase;letter-spacing:.14em;margin-top:.5vh}

.tvs-lb{justify-content:flex-start;gap:2.4vh}
.tvs-lb-head{font-weight:900;letter-spacing:.14em;font-size:min(6vw,6.4vh);
  background:linear-gradient(90deg,#4c8dff,#9cc4ff);-webkit-background-clip:text;background-clip:text;color:transparent}
.tvs-lb-list{list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:1.4vh;width:88vw;flex:1}
.tvs-lb-row{display:grid;grid-template-columns:min(9vw,9vh) min(12vw,13vh) 1fr auto;align-items:center;gap:2.4vw;
  background:rgba(255,255,255,.05);border:1px solid rgba(255,255,255,.07);border-radius:2vh;padding:1.5vh 2.4vw}
.tvs-lb-row.r1{background:linear-gradient(90deg,rgba(76,141,255,.26),rgba(76,141,255,.05));border-color:rgba(76,141,255,.5)}
.tvs-lb-row.r2{background:rgba(203,213,225,.13)}
.tvs-lb-row.r3{background:rgba(148,163,184,.15)}
.tvs-lb-rank{font-weight:900;font-size:min(5.4vw,5.6vh);text-align:center}
.tvs-lb-photo{display:flex;justify-content:center}
.tvs-lb-name{font-weight:800;font-size:min(4.4vw,5vh);text-align:left;display:flex;align-items:center;gap:1.4vw}
.tvs-lb-streak{font-size:min(2.2vw,2.4vh);color:#7db4ff;font-weight:700}
.tvs-lb-pts{font-weight:900;font-size:min(5vw,5.6vh);color:#7CF5C4;white-space:nowrap}
.tvs-lb-pts small{font-size:.36em;color:#9fb0d9;margin-left:.5vw;letter-spacing:.12em}

.tvs-prod{justify-content:flex-start;gap:2.4vh}
.tvs-prod-head{font-weight:900;letter-spacing:.14em;font-size:min(6vw,6.4vh);
  background:linear-gradient(90deg,#FFB020,#FFD97A);-webkit-background-clip:text;background-clip:text;color:transparent}
.tvs-prod-list{list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:1.3vh;width:90vw;flex:1}
.tvs-prod-row{display:grid;grid-template-columns:min(12vw,13vh) 1fr auto;align-items:center;gap:2.6vw;
  background:rgba(255,255,255,.05);border:1px solid rgba(255,255,255,.07);border-radius:2vh;padding:1.4vh 2.4vw}
.tvs-prod-photo{display:flex;justify-content:center}
.tvs-prod-name{font-weight:800;font-size:min(4.6vw,5.2vh);text-align:left}
.tvs-prod-nums{display:flex;gap:3.2vw}
.tvs-prod-n{display:flex;flex-direction:column;align-items:center;line-height:1}
.tvs-prod-n b{font-weight:900;font-size:min(6vw,6.6vh);color:#FFD97A}
.tvs-prod-n em{font-style:normal;font-size:min(1.7vw,1.9vh);color:#9fb0d9;text-transform:uppercase;letter-spacing:.14em;margin-top:.7vh}

.tvs-ph{gap:2.6vh}
.tvs-ph-tag{font-weight:800;letter-spacing:.4em;color:#FFB020;text-transform:uppercase;font-size:min(2.8vw,3vh)}
.tvs-ph-title{font-weight:900;font-size:min(9vw,10vh);
  background:linear-gradient(90deg,#FFB020,#FFE08A);-webkit-background-clip:text;background-clip:text;color:transparent}
.tvs-ph-msg{font-size:min(3.2vw,3.4vh);color:#c7d3f2;max-width:74vw}

.tvs-ach{gap:2.2vh}
.tvs-ach-tag{font-weight:800;letter-spacing:.4em;color:#8fbcff;text-transform:uppercase;font-size:min(2.6vw,2.8vh)}
.tvs-ach-name{font-weight:900;font-size:min(8vw,9vh)}
.tvs-ach-head{font-weight:900;font-size:min(5.4vw,6vh);letter-spacing:.04em;
  background:linear-gradient(90deg,#4c8dff,#34F5C5);-webkit-background-clip:text;background-clip:text;color:transparent;
  text-transform:uppercase}
.tvs-ach-meta{display:flex;align-items:center;gap:1.6vw;font-size:min(2.8vw,3vh);color:#9fb0d9}
.tvs-ach-chip{border:1px solid rgba(255,255,255,.2);border-radius:999px;padding:.5vh 1.4vw;letter-spacing:.16em}
.tvs-ach-pts{color:#8CFFD3;font-weight:900}
.tvs-ach-when{opacity:.7}
`;
