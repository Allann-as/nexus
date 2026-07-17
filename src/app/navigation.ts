/**
 * The navigation map — the single source of truth for routes, sidebar order
 * and the `G+<key>` jump shortcuts. Adding a module means adding one entry
 * here; the sidebar, the router and the keyboard layer all read from it.
 */

import {
  LayoutDashboard,
  Inbox,
  Sun,
  Calendar,
  Repeat,
  Target,
  FileText,
  History,
  Sparkles,
  type LucideIcon,
} from "lucide-react";

export interface NavItem {
  path: string;
  label: string;
  icon: LucideIcon;
  /** Second key of the `G+<key>` sequence. */
  jumpKey: string;
}

export const NAV_ITEMS: NavItem[] = [
  { path: "/", label: "Dashboard", icon: LayoutDashboard, jumpKey: "d" },
  { path: "/inbox", label: "Inbox", icon: Inbox, jumpKey: "i" },
  { path: "/today", label: "Hoje", icon: Sun, jumpKey: "h" },
  { path: "/calendar", label: "Calendário", icon: Calendar, jumpKey: "c" },
  { path: "/habits", label: "Hábitos", icon: Repeat, jumpKey: "b" },
  { path: "/goals", label: "Metas & Projetos", icon: Target, jumpKey: "m" },
  { path: "/notes", label: "Notas", icon: FileText, jumpKey: "n" },
  { path: "/timeline", label: "Timeline", icon: History, jumpKey: "t" },
  { path: "/insights", label: "Insights", icon: Sparkles, jumpKey: "s" },
];
