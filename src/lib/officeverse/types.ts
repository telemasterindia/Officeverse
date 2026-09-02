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
