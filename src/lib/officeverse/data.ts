import type {
  AppNotification,
  AuditEntry,
  Employee,
  FollowUp,
  Lead,
  ProcessCode,
  ProcessInfo,
  Role,
  SessionUser,
} from "./types";

export const PROCESSES: Record<ProcessCode, ProcessInfo> = {
  US: {
    code: "US",
    label: "US Process",
    shift: "US SHIFT",
    flags: "🇮🇳 → 🇺🇸",
    hours: "21:00 – 06:00 IST",
  },
  UK: {
    code: "UK",
    label: "UK Process",
    shift: "UK SHIFT",
    flags: "🇮🇳 → 🇬🇧",
    hours: "13:00 – 22:00 IST",
  },
  IN: {
    code: "IN",
    label: "India Process",
    shift: "INDIA SHIFT",
    flags: "🇮🇳",
    hours: "09:30 – 18:30 IST",
  },
  AU: {
    code: "AU",
    label: "AU Process",
    shift: "AU SHIFT",
    flags: "🇮🇳 → 🇦🇺",
    hours: "04:30 – 13:30 IST",
  },
};

export const DEMO_USERS: Record<Role, SessionUser> = {
  agent: {
    id: "u_ayush",
    name: "Ayush Verma",
    role: "agent",
    designation: "Sales Agent",
    process: "US",
    employeeId: "EVL-1042",
    initials: "AV",
    email: "ayush@exclusiveverifiedleads.com",
  },
  closer: {
    id: "u_gurpreet",
    name: "Gurpreet Singh",
    role: "closer",
    designation: "Senior Closer",
    process: "US",
    employeeId: "EVL-1008",
    initials: "GS",
    email: "gurpreet@exclusiveverifiedleads.com",
  },
  hr: {
    id: "u_lakshita",
    name: "Lakshita Rao",
    role: "hr",
    designation: "HR Executive",
    process: "IN",
    employeeId: "EVL-1003",
    initials: "LR",
    email: "lakshita@exclusiveverifiedleads.com",
  },
  admin: {
    id: "u_amit",
    name: "Amit Chadha",
    role: "admin",
    designation: "Operations Head",
    process: "IN",
    employeeId: "EVL-1001",
    initials: "AC",
    email: "amit@exclusiveverifiedleads.com",
  },
};

export const ROLE_LABEL: Record<Role, string> = {
  agent: "Agent",
  closer: "Closer",
  hr: "HR",
  admin: "Admin",
};

export const QUOTES = [
  "Don't wait for the perfect moment. Create it.",
  "Small steps every day become big results.",
  "Your next win might be one conversation away.",
  "Consistency beats intensity.",
  "Do the work. Let the results catch up.",
  "Focus on the next action, not the entire mountain.",
  "Progress, not perfection.",
  "Your attitude decides the altitude.",
  "Follow-ups don't chase themselves.",
  "Another day. Another win.",
];

export const CLOSERS = ["Gurpreet Singh", "Neha Kapoor", "Rohit Menon"];
export const AGENTS = ["Ayush Verma", "Rahul Sharma", "Priya Nair", "Simran Kaur", "Karan Patel"];
const FILES = ["July Batch A", "July Batch B", "August Batch A", "Refi Q3", "Retarget List 4"];
const STATES = ["TX", "FL", "CA", "OH", "NY", "GA", "AZ", "NC"];
const CITIES = ["Austin", "Tampa", "Fresno", "Columbus", "Buffalo", "Macon", "Mesa", "Durham"];

function pick<T>(arr: T[], i: number): T {
  return arr[i % arr.length]!;
}

function pad(n: number) {
  return String(n).padStart(8, "0");
}

const LEAD_NAMES = [
  "John Smith",
  "Maria Lopez",
  "David Bennett",
  "Angela Cruz",
  "Robert Hayes",
  "Linda Parker",
  "Michael Doyle",
  "Sandra Willis",
];

export const LEADS: Lead[] = Array.from({ length: 48 }, (_, i) => {
  const statuses = ["NEW", "ASSIGNED", "ACCEPTED", "FOLLOW-UP", "REJECTED", "COMPLETED"] as const;
  const name = pick(LEAD_NAMES, i);
  const [first, last] = name.toLowerCase().split(" ");
  return {
    lead_id: `TMI_${pad(12000 + i * 7)}`,
    customer_name: name,
    email: `${first}.${last}${i}@example.com`,
    phone: `+1 ${300 + (i % 90)} ${200 + (i % 700)} ${1000 + ((i * 37) % 8999)}`,
    address: `${100 + i * 3} Maple Street`,
    city: pick(CITIES, i),
    state: pick(STATES, i),
    zip: String(30000 + i * 137),
    debt_amount: 8000 + ((i * 1450) % 42000),
    credit: pick(["Excellent", "Good", "Fair", "Poor"], i),
    current_late: i % 3 === 0 ? "Late" : "Current",
    comment: pick(
      [
        "Customer asked to call after payday.",
        "Interested, wants the paperwork by email.",
        "Spouse handles finances, callback evening.",
        "Comparing two offers, follow up Friday.",
      ],
      i,
    ),
    file_name: pick(FILES, i),
    submitted_by: pick(AGENTS, i),
    assigned_closer: pick(CLOSERS, i),
    status: pick([...statuses], i),
    created_at: `2026-08-${String(10 + (i % 17)).padStart(2, "0")}`,
    last_activity: `${1 + (i % 9)}h ago`,
    process: pick(["US", "UK", "IN", "AU"] as ProcessCode[], i % 7 === 0 ? i : 0),
  };
});

export const FOLLOW_UPS: FollowUp[] = Array.from({ length: 34 }, (_, i) => {
  const bucket = (["TODAY", "UPCOMING", "OVERDUE", "COMPLETED"] as const)[i % 4]!;
  return {
    follow_up_id: `FU_${pad(4400 + i * 3)}`,
    lead_id: LEADS[i % LEADS.length]!.lead_id,
    customer_name: LEADS[i % LEADS.length]!.customer_name,
    phone: LEADS[i % LEADS.length]!.phone,
    follow_up_date:
      bucket === "OVERDUE"
        ? `2026-08-${String(18 + (i % 6)).padStart(2, "0")}`
        : bucket === "UPCOMING"
          ? `2026-08-${String(28 + (i % 3)).padStart(2, "0")}`
          : "2026-08-27",
    follow_up_time: `${String(9 + (i % 9)).padStart(2, "0")}:${i % 2 ? "30" : "00"} ${i % 9 < 3 ? "AM" : "PM"}`,
    comment: pick(
      [
        "Customer requested a callback.",
        "Send the statement copy before calling.",
        "Wants to confirm with spouse first.",
        "Asked to call after payday.",
      ],
      i,
    ),
    created_by: pick(AGENTS, i),
    current_assignee: i % 3 === 0 ? pick(CLOSERS, i) : pick(AGENTS, i),
    assignee_role: i % 3 === 0 ? "closer" : "agent",
    status: bucket,
    last_meaningful_update: `${1 + (i % 6)}d ago`,
    created_at: `2026-08-${String(5 + (i % 20)).padStart(2, "0")}`,
  };
});

export const EMPLOYEES: Employee[] = [
  ...AGENTS.map((name, i) => ({
    id: `e_${i}`,
    name,
    employee_id: `EVL-10${40 + i}`,
    department: "Sales",
    designation: "Sales Agent",
    joining_date: `2025-0${1 + (i % 8)}-1${i % 9}`,
    status: (["Present", "Late", "Present", "On Leave", "Present"] as const)[i % 5]!,
    process: (["US", "UK", "US", "AU", "IN"] as ProcessCode[])[i % 5]!,
    presence: (["online", "online", "away", "offline", "online"] as const)[i % 5]!,
  })),
  ...CLOSERS.map((name, i) => ({
    id: `c_${i}`,
    name,
    employee_id: `EVL-100${8 + i}`,
    department: "Closing",
    designation: "Senior Closer",
    joining_date: `2024-1${i % 3}-0${2 + i}`,
    status: (["Present", "Present", "Half Day"] as const)[i % 3]!,
    process: (["US", "UK", "US"] as ProcessCode[])[i % 3]!,
    presence: (["online", "away", "online"] as const)[i % 3]!,
  })),
  {
    id: "h_0",
    name: "Lakshita Rao",
    employee_id: "EVL-1003",
    department: "People",
    designation: "HR Executive",
    joining_date: "2024-05-06",
    status: "Present",
    process: "IN",
    presence: "online",
  },
  {
    id: "a_0",
    name: "Amit Chadha",
    employee_id: "EVL-1001",
    department: "Operations",
    designation: "Operations Head",
    joining_date: "2023-02-01",
    status: "Present",
    process: "IN",
    presence: "online",
  },
];

export const NOTIFICATIONS: AppNotification[] = [
  {
    id: "n1",
    category: "Follow-ups",
    title: "Follow-up in 15 minutes",
    body: "John Smith · TMI_00012000 — Customer requested a callback.",
    time: "2 min ago",
    unread: true,
  },
  {
    id: "n2",
    category: "Leads",
    title: "New lead assigned",
    body: "TMI_00012049 assigned to you by Amit Chadha.",
    time: "18 min ago",
    unread: true,
  },
  {
    id: "n3",
    category: "Leads",
    title: "Lead rejected",
    body: "TMI_00012021 rejected — incomplete debt information.",
    time: "1 hr ago",
    unread: true,
  },
  {
    id: "n4",
    category: "Follow-ups",
    title: "Follow-up overdue",
    body: "Angela Cruz · FU_00004412 is 3 days overdue.",
    time: "3 hrs ago",
    unread: false,
  },
  {
    id: "n5",
    category: "System",
    title: "Shift summary ready",
    body: "Yesterday's US shift summary is available in Reports.",
    time: "Yesterday",
    unread: false,
  },
];

export const AUDIT: AuditEntry[] = Array.from({ length: 14 }, (_, i) => ({
  id: `a_${i}`,
  actor: pick([...AGENTS, ...CLOSERS, "Amit Chadha"], i),
  action: pick(
    [
      "submitted a lead",
      "accepted a lead",
      "rejected a lead",
      "reassigned a follow-up",
      "completed a follow-up",
    ],
    i,
  ),
  target: LEADS[i]!.lead_id,
  time: `${1 + i} hr ago`,
}));

export const FILE_PERFORMANCE = FILES.map((name, i) => ({
  name,
  leads: 143 - i * 18,
  followUps: 62 - i * 9,
  accepted: 38 - i * 6,
}));

export const FOLLOWUP_HEALTH = [
  { name: "Ayush", value: 20, d12: 9, d37: 7, d8: 4 },
  { name: "Gurpreet", value: 10, d12: 5, d37: 3, d8: 2 },
  { name: "Lakshita", value: 15, d12: 6, d37: 5, d8: 4 },
  { name: "Rahul", value: 12, d12: 7, d37: 3, d8: 2 },
  { name: "Priya", value: 8, d12: 4, d37: 2, d8: 2 },
];

export const SUBMISSION_TREND = [
  { day: "Mon", leads: 96, followUps: 62, accepted: 41 },
  { day: "Tue", leads: 118, followUps: 71, accepted: 52 },
  { day: "Wed", leads: 104, followUps: 66, accepted: 47 },
  { day: "Thu", leads: 143, followUps: 86, accepted: 61 },
  { day: "Fri", leads: 131, followUps: 78, accepted: 58 },
  { day: "Sat", leads: 88, followUps: 44, accepted: 32 },
  { day: "Sun", leads: 52, followUps: 26, accepted: 18 },
];

export const LEAD_STATUS_MIX = [
  { name: "New", value: 34 },
  { name: "Assigned", value: 48 },
  { name: "Accepted", value: 38 },
  { name: "Follow-up", value: 27 },
  { name: "Rejected", value: 14 },
];

export const AGENT_ACTIVITY = AGENTS.map((name, i) => ({
  name: name.split(" ")[0]!,
  leads: 28 - i * 3,
  followUps: 22 - i * 2,
  accepted: 16 - i * 2,
}));

export const TEAM_STATUS = [
  { name: "Ayush", presence: "online" as const },
  { name: "Rahul", presence: "online" as const },
  { name: "Priya", presence: "away" as const },
  { name: "Amit", presence: "offline" as const },
  { name: "Simran", presence: "online" as const },
];

export const ATTENDANCE_TREND = [
  { day: "Mon", present: 38, late: 4, absent: 2 },
  { day: "Tue", present: 41, late: 2, absent: 1 },
  { day: "Wed", present: 39, late: 5, absent: 0 },
  { day: "Thu", present: 42, late: 1, absent: 1 },
  { day: "Fri", present: 37, late: 6, absent: 1 },
];

/** Phone numbers that trigger the duplicate experience in the lead form. */
export const DUPLICATE_PHONES: Record<
  string,
  { lead_id: string; submitted_by: string; status: string }
> = {
  "5551234567": { lead_id: "TMI_00012345", submitted_by: "Rahul Sharma", status: "Assigned" },
  "5550001111": { lead_id: "TMI_00012123", submitted_by: "Priya Nair", status: "Accepted" },
};
