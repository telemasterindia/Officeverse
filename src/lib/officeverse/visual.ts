/**
 * Officeverse visual vocabulary — shared, non-component constants and helpers.
 * Pure data: no React, no side effects. Consumed by the officeverse/* components.
 * This file adds visual metadata only; it never touches business logic or data shapes.
 */
import type { FollowUpStatus } from "./types";

export type RoomKey = "workspace" | "deal" | "command" | "people" | "generic";

export const ROOM_META: Record<RoomKey, { label: string; emoji: string; tagline: string }> = {
  workspace: { label: "My Workspace", emoji: "🎯", tagline: "Your desk in TeleMaster India." },
  deal: { label: "Deal Room", emoji: "💼", tagline: "Where the pipeline becomes revenue." },
  command: { label: "Command Center", emoji: "🛰️", tagline: "The whole floor, at a glance." },
  people: { label: "People Hub", emoji: "🌱", tagline: "The human side of TeleMaster India." },
  generic: { label: "TeleMaster India", emoji: "🏢", tagline: "A living digital workplace." },
};

/** Map a route pathname to the room it belongs to. Route paths are never changed. */
export function roomForPath(pathname: string): RoomKey {
  const p = pathname.toLowerCase();
  if (p.startsWith("/workspace")) return "workspace";
  if (p.startsWith("/closer-hub") || p.startsWith("/team")) return "deal";
  if (
    p.startsWith("/mission-control") ||
    p.startsWith("/assignments") ||
    p.startsWith("/agents") ||
    p.startsWith("/closers") ||
    p.startsWith("/reports") ||
    p.startsWith("/exports") ||
    p.startsWith("/audit") ||
    p.startsWith("/settings")
  ) {
    return "command";
  }
  if (
    p.startsWith("/people") ||
    p.startsWith("/employees") ||
    p.startsWith("/attendance") ||
    p.startsWith("/leave")
  ) {
    return "people";
  }
  return "generic";
}

/** Door glyph per existing route. Keyed by the exact `to` values already in nav.ts. */
export const DOOR_EMOJI: Record<string, string> = {
  "/workspace": "🎯",
  "/leads": "🗂️",
  "/leads/new": "✨",
  "/followups": "📅",
  "/closer-hub": "💼",
  "/team": "🤝",
  "/mission-control": "🛰️",
  "/assignments": "🎛️",
  "/agents": "🧑‍💼",
  "/closers": "🎧",
  "/people": "🌱",
  "/employees": "📇",
  "/attendance": "🗓️",
  "/leave": "🌴",
  "/reports": "📈",
  "/exports": "📤",
  "/audit": "🛡️",
  "/notifications": "🔔",
  "/profile": "🪪",
  "/settings": "⚙️",
};

export type PresenceKey = "online" | "away" | "offline" | "busy";
export type OfficeverseStatusKey = PresenceKey | "followup-due" | "needs-attention" | "completed";

export const STATUS_META: Record<
  OfficeverseStatusKey,
  { label: string; color: string; pulse?: boolean }
> = {
  online: { label: "Online", color: "var(--success)" },
  away: { label: "Away", color: "var(--warning)" },
  offline: { label: "Offline", color: "var(--muted-foreground)" },
  busy: { label: "Busy", color: "var(--destructive)" },
  "followup-due": { label: "Follow-up due", color: "var(--info)", pulse: true },
  "needs-attention": { label: "Needs attention", color: "var(--warning)", pulse: true },
  completed: { label: "Completed", color: "var(--success)" },
};

export type MissionStateKey = "upcoming" | "due-soon" | "overdue" | "needs-attention" | "updated";

export const MISSION_STATE_META: Record<
  MissionStateKey,
  { label: string; emoji: string; className: string }
> = {
  upcoming: { label: "Upcoming", emoji: "🎯", className: "border-info/30 bg-info/15 text-info" },
  "due-soon": {
    label: "Due soon",
    emoji: "⏰",
    className: "border-accent/30 bg-accent/15 text-accent",
  },
  overdue: {
    label: "Overdue",
    emoji: "⚠️",
    className: "border-warning/35 bg-warning/18 text-warning",
  },
  "needs-attention": {
    label: "Needs attention",
    emoji: "🔥",
    className: "border-destructive/30 bg-destructive/15 text-destructive",
  },
  updated: {
    label: "Updated",
    emoji: "✅",
    className: "border-success/30 bg-success/15 text-success",
  },
};

/** Visual-only projection of the existing FollowUpStatus. Does not alter follow-up logic. */
export function missionStateFromFollowUp(status: FollowUpStatus): MissionStateKey {
  switch (status) {
    case "TODAY":
      return "due-soon";
    case "UPCOMING":
      return "upcoming";
    case "OVERDUE":
      return "overdue";
    case "COMPLETED":
      return "updated";
    default:
      return "upcoming";
  }
}

/** Last flag token from a PROCESSES `flags` string, e.g. "🇮🇳 → 🇺🇸" -> "🇺🇸". */
export function partnerFlag(flags: string): string {
  const parts = flags.trim().split(/\s+/).filter(Boolean);
  return parts[parts.length - 1] || "🇮🇳";
}
