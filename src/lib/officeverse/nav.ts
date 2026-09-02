import {
  Activity,
  BadgeCheck,
  Bell,
  Building2,
  CalendarCheck,
  CalendarClock,
  CalendarDays,
  ClipboardList,
  Download,
  FileBarChart,
  FileText,
  Gauge,
  Gift,
  LayoutDashboard,
  ListChecks,
  Plane,
  Settings,
  Network,
  ShieldCheck,
  SlidersHorizontal,
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
        { label: "My Incentive", to: "/incentives", icon: Gift },
        { label: "Bulk Import", to: "/imports", icon: Upload },
      ],
    },
    {
      group: "You",
      items: [
        { label: "Notifications", to: "/notifications", icon: Bell },
        { label: "My Attendance", to: "/attendance", icon: CalendarCheck },
        { label: "Leave", to: "/leave", icon: Plane },
        { label: "Holidays", to: "/holidays", icon: CalendarDays },
        { label: "My Payroll", to: "/payroll", icon: Wallet },
        { label: "HR Policies", to: "/policies", icon: FileText },
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
        { label: "My Incentive", to: "/incentives", icon: Gift },
        { label: "Team", to: "/team", icon: Users2 },
      ],
    },
    {
      group: "Operations",
      items: [
        { label: "Operations Control", to: "/operations", icon: SlidersHorizontal },
        { label: "Performance", to: "/performance", icon: Trophy },
      ],
    },
    {
      group: "You",
      items: [
        { label: "Notifications", to: "/notifications", icon: Bell },
        { label: "My Attendance", to: "/attendance", icon: CalendarCheck },
        { label: "Leave", to: "/leave", icon: Plane },
        { label: "Holidays", to: "/holidays", icon: CalendarDays },
        { label: "My Payroll", to: "/payroll", icon: Wallet },
        { label: "HR Policies", to: "/policies", icon: FileText },
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
        { label: "HR Policy", to: "/policies", icon: FileText },
        { label: "Leaderboard", to: "/leaderboard", icon: Trophy },
        { label: "Reports", to: "/reports", icon: FileBarChart },
      ],
    },
    {
      group: "You",
      items: [{ label: "Profile", to: "/profile", icon: UserCircle }],
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
        { label: "HR Policy", to: "/policies", icon: FileText },
        { label: "Attendance", to: "/attendance", icon: CalendarCheck },
        { label: "Leave & Off", to: "/leave", icon: Plane },
        { label: "Holidays & Bonus", to: "/holidays", icon: CalendarDays },
        { label: "Payroll", to: "/payroll", icon: Wallet },
        { label: "Shift Timing", to: "/shifts", icon: CalendarClock },
      ],
    },
    {
      group: "Insights",
      items: [
        { label: "Operations Control", to: "/operations", icon: SlidersHorizontal },
        { label: "Performance", to: "/performance", icon: Trophy },
        { label: "My Incentive", to: "/incentives", icon: Gift },
        { label: "Scoring Engine", to: "/scoring", icon: SlidersHorizontal },
        { label: "Reports", to: "/reports", icon: FileBarChart },
        { label: "Bulk Import", to: "/imports", icon: Upload },
        { label: "Exports", to: "/exports", icon: Download },
        { label: "Office Networks", to: "/office-networks", icon: Network },
        { label: "Company Branding", to: "/company", icon: Building2 },
        { label: "Audit", to: "/audit", icon: ShieldCheck },
        { label: "Activity", to: "/notifications", icon: Activity },
        { label: "Settings", to: "/settings", icon: Settings },
      ],
    },
  ],
};

export const HOME_BY_ROLE: Record<Role, string> = {
  agent: "/workspace",
  closer: "/closer-hub",
  hr: "/people",
  admin: "/mission-control",
};
