import {
  Activity,
  BadgeCheck,
  Bell,
  CalendarCheck,
  CalendarDays,
  ClipboardList,
  Download,
  FileBarChart,
  Gauge,
  LayoutDashboard,
  ListChecks,
  Palette,
  Plane,
  Settings,
  Network,
  ShieldCheck,
  Target,
  Trophy,
  Tv,
  Upload,
  UserCircle,
  UserPlus,
  Users,
  Users2,
  Wallet,
} from "lucide-react";
import type { Role } from "./types";

export interface NavItem {
  label: string;
  to: string;
  icon: typeof Gauge;
  exact?: boolean;
}

export const NAV_BY_ROLE: Record<Role, { group: string; items: NavItem[] }[]> = {
  agent: [
    {
      group: "Workspace",
      items: [
        { label: "My Workspace", to: "/workspace", icon: LayoutDashboard },
        { label: "New Lead", to: "/leads/new", icon: Target },
        { label: "My Leads", to: "/leads", icon: ClipboardList, exact: true },
        { label: "Follow-ups", to: "/followups", icon: ListChecks },
        { label: "Leaderboard", to: "/leaderboard", icon: Trophy },
        { label: "Bulk Import", to: "/imports", icon: Upload },
      ],
    },
    {
      group: "You",
      items: [
        { label: "Avatar Studio", to: "/avatar-studio", icon: Palette },
        { label: "Notifications", to: "/notifications", icon: Bell },
        { label: "My Attendance", to: "/attendance", icon: CalendarCheck },
        { label: "Leave", to: "/leave", icon: Plane },
        { label: "Holidays", to: "/holidays", icon: CalendarDays },
        { label: "My Payroll", to: "/payroll", icon: Wallet },
        { label: "Profile", to: "/profile", icon: UserCircle },
      ],
    },
  ],
  closer: [
    {
      group: "Pipeline",
      items: [
        { label: "Closer Hub", to: "/closer-hub", icon: Gauge },
        { label: "My Leads", to: "/leads", icon: ClipboardList, exact: true },
        { label: "My Follow-ups", to: "/followups", icon: ListChecks },
        { label: "Leaderboard", to: "/leaderboard", icon: Trophy },
        { label: "Team", to: "/team", icon: Users2 },
      ],
    },
    {
      group: "You",
      items: [
        { label: "Avatar Studio", to: "/avatar-studio", icon: Palette },
        { label: "Notifications", to: "/notifications", icon: Bell },
        { label: "My Attendance", to: "/attendance", icon: CalendarCheck },
        { label: "Leave", to: "/leave", icon: Plane },
        { label: "Holidays", to: "/holidays", icon: CalendarDays },
        { label: "My Payroll", to: "/payroll", icon: Wallet },
        { label: "Profile", to: "/profile", icon: UserCircle },
      ],
    },
  ],
  hr: [
    {
      group: "People",
      items: [
        { label: "People Hub", to: "/people", icon: Users },
        { label: "Employees", to: "/employees", icon: BadgeCheck },
        { label: "Attendance", to: "/attendance", icon: CalendarCheck },
        { label: "Leave", to: "/leave", icon: Plane },
        { label: "Holidays", to: "/holidays", icon: CalendarDays },
        { label: "Payroll", to: "/payroll", icon: Wallet },
        { label: "Office Networks", to: "/office-networks", icon: Network },
        { label: "Leaderboard", to: "/leaderboard", icon: Trophy },
        { label: "Reports", to: "/reports", icon: FileBarChart },
      ],
    },
    {
      group: "You",
      items: [
        { label: "Avatar Studio", to: "/avatar-studio", icon: Palette },
        { label: "Profile", to: "/profile", icon: UserCircle },
      ],
    },
  ],
  admin: [
    {
      group: "Command",
      items: [
        { label: "Mission Control", to: "/mission-control", icon: Gauge },
        { label: "Leads", to: "/leads", icon: ClipboardList, exact: true },
        { label: "Follow-ups", to: "/followups", icon: ListChecks },
        { label: "Assignments", to: "/assignments", icon: Target },
        { label: "Agent Presence", to: "/presence", icon: Activity },
        { label: "Leaderboard", to: "/leaderboard", icon: Trophy },
        { label: "Live Office", to: "/live", icon: Tv },
      ],
    },
    {
      group: "Agents",
      items: [
        { label: "Create Agent", to: "/agents/new", icon: UserPlus },
        { label: "Agent List", to: "/agents", icon: Users2, exact: true },
      ],
    },
    {
      group: "Closers",
      items: [
        { label: "Create Closer", to: "/closers/new", icon: UserPlus },
        { label: "Closer List", to: "/closers", icon: BadgeCheck, exact: true },
      ],
    },
    {
      group: "Clients",
      items: [
        { label: "Create Client", to: "/clients/new", icon: UserPlus },
        { label: "Client List", to: "/clients", icon: Users, exact: true },
      ],
    },
    {
      group: "Teams",
      items: [
        { label: "HR", to: "/people", icon: Users },
        { label: "Attendance", to: "/attendance", icon: CalendarCheck },
        { label: "Leave & Off", to: "/leave", icon: Plane },
        { label: "Holidays & Bonus", to: "/holidays", icon: CalendarDays },
        { label: "Payroll", to: "/payroll", icon: Wallet },
      ],
    },
    {
      group: "Insights",
      items: [
        { label: "Reports", to: "/reports", icon: FileBarChart },
        { label: "Bulk Import", to: "/imports", icon: Upload },
        { label: "Exports", to: "/exports", icon: Download },
        { label: "Office Networks", to: "/office-networks", icon: Network },
        { label: "Audit", to: "/audit", icon: ShieldCheck },
        { label: "Activity", to: "/notifications", icon: Activity },
        { label: "Settings", to: "/settings", icon: Settings },
      ],
    },
    {
      group: "You",
      items: [{ label: "Avatar Studio", to: "/avatar-studio", icon: Palette }],
    },
  ],
};

export const HOME_BY_ROLE: Record<Role, string> = {
  agent: "/workspace",
  closer: "/closer-hub",
  hr: "/people",
  admin: "/mission-control",
};
