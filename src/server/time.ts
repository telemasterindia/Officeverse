/**
 * Officeverse — canonical server-side time & shift-date module (Phase 7).
 *
 * ONE source of truth. Reuses the existing pure logic in
 * `src/lib/officeverse/shift.ts` (shiftDateIST / shiftWindow / istParts) — no
 * duplicated date math anywhere.
 *
 * Everything is expressed in IST WALL-CLOCK strings ("YYYY-MM-DD HH:MM:SS"),
 * which is exactly what the MySQL `datetime` columns store (see db/schema.ts)
 * and what the existing client uses (buildScheduledAt / scheduledParts). The
 * server process should also run with TZ=Asia/Kolkata, but correctness does not
 * depend on it.
 */
import { istParts, shiftDateIST, shiftWindow } from "@/lib/officeverse/shift";
import type { ProcessCode } from "@/lib/officeverse/types";

export { shiftDateIST, shiftWindow, istParts };

const IST_TZ = "Asia/Kolkata";
const IST_OFFSET_MIN = 5 * 60 + 30; // +05:30

/** Current IST wall-clock as "YYYY-MM-DD HH:MM:SS". Use for created_at/updated_at. */
export function nowIST(instant: number | Date = Date.now()): string {
  const ms = instant instanceof Date ? instant.getTime() : instant;
  const p = new Intl.DateTimeFormat("en-CA", {
    timeZone: IST_TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).formatToParts(new Date(ms));
  const g = (t: string) => p.find((x) => x.type === t)?.value ?? "00";
  const hh = g("hour") === "24" ? "00" : g("hour");
  return `${g("year")}-${g("month")}-${g("day")} ${hh}:${g("minute")}:${g("second")}`;
}

/** Operational shift date right now ("YYYY-MM-DD"). */
export function currentShiftDate(
  process: ProcessCode = "US",
  instant: number | Date = Date.now(),
): string {
  return shiftDateIST(instant, process);
}

/**
 * Interpret an IST wall-clock string as absolute epoch milliseconds.
 * Accepts "YYYY-MM-DD HH:MM[:SS]", "YYYY-MM-DDTHH:MM[:SS]", and an optional
 * trailing "+05:30" (ignored — always treated as IST).
 */
export function istWallClockToEpochMs(wall: string): number {
  const s = wall
    .trim()
    .replace("T", " ")
    .replace(/\+05:30$/, "")
    .trim();
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})[ ](\d{2}):(\d{2})(?::(\d{2}))?$/);
  if (!m) throw new Error(`Not an IST wall-clock string: "${wall}"`);
  const [, y, mo, d, h, mi, se] = m;
  // Build as if UTC, then subtract the IST offset to get the true instant.
  const asUtc = Date.UTC(+y!, +mo! - 1, +d!, +h!, +mi!, se ? +se : 0);
  return asUtc - IST_OFFSET_MIN * 60_000;
}

/** IST wall-clock string for an absolute instant, minute precision. */
export function epochMsToIstWallClock(ms: number): string {
  return nowIST(ms).slice(0, 16) + ":00";
}

/** Minutes from `now` until `scheduledWall` (negative once past). */
export function minutesUntilIST(scheduledWall: string, nowWall: string = nowIST()): number {
  return (istWallClockToEpochMs(scheduledWall) - istWallClockToEpochMs(nowWall)) / 60_000;
}

/** Split an IST wall-clock string into date + "HH:MM". */
export function wallParts(wall: string): { date: string; time: string } {
  const s = wall.trim().replace("T", " ");
  return { date: s.slice(0, 10), time: s.slice(11, 16) };
}

export function addDaysYMD(ymd: string, delta: number): string {
  const [y, m, d] = ymd.split("-").map(Number);
  return new Date(Date.UTC(y!, m! - 1, d! + delta)).toISOString().slice(0, 10);
}

/** Calendar date in IST right now ("YYYY-MM-DD") — NOT the shift date. */
export function calendarTodayIST(instant: number | Date = Date.now()): string {
  return nowIST(instant).slice(0, 10);
}

/**
 * Build the canonical scheduled_at (IST wall-clock "YYYY-MM-DD HH:MM:00") from a
 * client-supplied calendar date + time. Mirrors the existing client
 * buildScheduledAt() but stores a bare wall-clock string (no offset) to match
 * the MySQL `datetime` columns.
 */
export function toScheduledWallClock(dateYMD: string, timeHM: string): string {
  const [h = "09", m = "00"] = timeHM.split(":");
  const two = (s: string) => String(Number(s)).padStart(2, "0");
  return `${dateYMD} ${two(h)}:${two(m)}:00`;
}

/** IST wall-clock string → ISO string with the +05:30 offset (client display). */
export function wallToIstIso(wall: string): string {
  const s = wall.trim().replace(" ", "T");
  return /\+\d\d:\d\d$/.test(s) ? s : `${s}+05:30`;
}

/**
 * Next upcoming shift-start instant for `process`, as an IST wall-clock string
 * "YYYY-MM-DD HH:MM:00". If today's shift-start is still in the future it is
 * returned; otherwise tomorrow's.
 */
export function nextShiftStartIST(
  process: ProcessCode = "US",
  instant: number | Date = Date.now(),
): string {
  const { start } = shiftWindow(process);
  const { date } = istParts(instant);
  const todayStart = `${date} ${start}:00`;
  if (istWallClockToEpochMs(todayStart) > (instant instanceof Date ? instant.getTime() : instant)) {
    return todayStart;
  }
  return `${addDaysYMD(date, 1)} ${start}:00`;
}

/** Shift-end instant for a given shift-start (IST wall-clock). */
export function shiftEndForStart(shiftStartWall: string, process: ProcessCode = "US"): string {
  const { end, overnight } = shiftWindow(process);
  const { date } = wallParts(shiftStartWall);
  return `${overnight ? addDaysYMD(date, 1) : date} ${end}:00`;
}
