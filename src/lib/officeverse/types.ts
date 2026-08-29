export type Role = "agent" | "closer" | "hr" | "admin";

export type ProcessCode = "US" | "UK" | "IN" | "AU";

export interface ProcessInfo {
  code: ProcessCode;
  label: string;
  shift: string;
  flags: string;
  hours: string;
}

export interface SessionUser {
  id: string;
  name: string;
  role: Role;
  designation: string;
  process: ProcessCode;
  employeeId: string;
  initials: string;
  email: string;
}

export type LeadStatus = "NEW" | "ASSIGNED" | "ACCEPTED" | "REJECTED" | "FOLLOW-UP" | "COMPLETED";

export interface Lead {
  lead_id: string;
  customer_name: string;
  email: string;
  phone: string;
  address: string;
  city: string;
  state: string;
  zip: string;
  debt_amount: number;
  credit: string;
  current_late: "Current" | "Late";
  comment: string;
  file_name: string;
  submitted_by: string;
  assigned_closer: string;
  status: LeadStatus;
  created_at: string;
  last_activity: string;
  process: ProcessCode;
}

export type FollowUpStatus = "TODAY" | "UPCOMING" | "OVERDUE" | "COMPLETED";

export interface FollowUp {
  follow_up_id: string;
  lead_id: string;
  customer_name: string;
  phone: string;
  follow_up_date: string;
  follow_up_time: string;
  comment: string;
  created_by: string;
  current_assignee: string;
  assignee_role: Role;
  status: FollowUpStatus;
  last_meaningful_update: string;
  created_at: string;
}

export interface Employee {
  id: string;
  name: string;
  employee_id: string;
  department: string;
  designation: string;
  joining_date: string;
  status: "Present" | "Late" | "Absent" | "On Leave" | "Half Day";
  process: ProcessCode;
  presence: "online" | "away" | "offline";
}

export interface AppNotification {
  id: string;
  category: "Leads" | "Follow-ups" | "System";
  title: string;
  body: string;
  time: string;
  unread: boolean;
}

export interface AuditEntry {
  id: string;
  actor: string;
  action: string;
  target: string;
  time: string;
}

/* ---------------------------------------------------------------------------
 * Officeverse character system (Phase 2A) — visual identity only.
 * Persisted client-side alongside the existing session (see session.tsx);
 * no backend, no change to SessionUser or any business contract.
 * ------------------------------------------------------------------------- */

export type SkinTone = "porcelain" | "light" | "tan" | "brown" | "deep" | "ebony";

export type HairStyle =
  | "buzz"
  | "short"
  | "fade"
  | "sidePart"
  | "spiky"
  | "messy"
  | "wavy"
  | "curly"
  | "coily"
  | "undercut"
  | "bun"
  | "ponytail"
  | "long"
  // legacy alias, still accepted from stored configs
  | "waves";

export type HairColor =
  "black" | "darkBrown" | "brown" | "chestnut" | "blonde" | "platinum" | "auburn" | "blueBlack";

export type FacialHair = "none" | "stubble" | "moustache" | "goatee" | "shortBeard" | "fullBeard";

export type Glasses = "none" | "round" | "rectangle" | "thin" | "browline";

export type Outfit =
  | "hoodie"
  | "tee"
  | "polo"
  | "shirt"
  | "blazer"
  | "turtleneck"
  | "bomber"
  | "varsity"
  | "overshirt"
  | "puffer"
  | "denim";

export type OutfitColor =
  "indigo" | "teal" | "charcoal" | "plum" | "sand" | "forest" | "rose" | "slate";

export type Headwear = "none" | "cap" | "capBack" | "beanie" | "headphones" | "headset" | "turban";

/**
 * Visual gender presentation for the character rig. Changes facial structure,
 * silhouette width, and detailing — not just colour. `neutral` sits between the
 * two. Deterministic per employee (see avatarFromSeed); a saved Avatar Studio
 * config always overrides.
 */
export type Presentation = "neutral" | "feminine" | "masculine";

export type Accessory =
  "none" | "lanyard" | "earbuds" | "chain" | "scarf" | "coffee" | "smartwatch" | "backpack";

export type Expression = "neutral" | "focused" | "happy" | "excited" | "thinking" | "concerned";

export type CharacterPose =
  | "idle"
  | "working"
  | "focused"
  | "happy"
  | "celebrating"
  | "thinking"
  | "concerned"
  | "tired"
  | "attention"
  | "wave";

export interface AvatarConfig {
  presentation: Presentation;
  skin: SkinTone;
  hair: HairStyle;
  hairColor: HairColor;
  facialHair: FacialHair;
  glasses: Glasses;
  outfit: Outfit;
  outfitColor: OutfitColor;
  headwear: Headwear;
  accessory: Accessory;
  expression: Expression;
}
