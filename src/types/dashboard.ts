// ParkCheck - Shared Dashboard Types & Contracts
// Phase 4 - Stage B: Shared Dashboard Shell Extraction

import { SessionPayload } from "@/domain/auth";

export type DashboardTab =
  | "gate"
  | "queue"
  | "inspection"
  | "incidents"
  | "vehicles"
  | "dashboard"
  | "reports";

export interface DashboardNavBadgeCounts {
  queueCount?: number;
  hasUrgentQueue?: boolean;
  incidentsCount?: number;
}

export interface DashboardNavigationProps {
  activeTab: DashboardTab;
  onTabChange: (tab: DashboardTab) => void;
  queueCount?: number;
  hasUrgentQueue?: boolean;
  incidentsCount?: number;
  userRole?: string;
}

export interface DashboardHeaderProps {
  user: SessionPayload;
  onLogout: () => void | Promise<void>;
}

export interface DashboardShellProps {
  header?: React.ReactNode;
  navigation?: React.ReactNode;
  children?: React.ReactNode;
}

export interface RoleBadgeProps {
  role: string;
  className?: string;
}

export interface IncidentStatusBadgeProps {
  status: string;
  size?: "sm" | "md";
  className?: string;
}

export interface IncidentStatusBadgeConfig {
  label: string;
  bg: string;
}
