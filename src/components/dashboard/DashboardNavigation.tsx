"use client";

import React from "react";
import {
  ArrowRightLeft,
  ClipboardList,
  Radio,
  AlertTriangle,
  Car,
  ShieldCheck,
  FileSpreadsheet,
} from "lucide-react";
import { DashboardNavigationProps, DashboardTab } from "@/types/dashboard";

interface TabItemConfig {
  id: DashboardTab;
  label: string;
  icon: React.ElementType;
  badge?: React.ReactNode;
  relative?: boolean;
}

export function DashboardNavigation({
  activeTab,
  onTabChange,
  queueCount = 0,
  hasUrgentQueue = false,
  incidentsCount = 0,
}: DashboardNavigationProps) {
  const tabs: TabItemConfig[] = [
    {
      id: "gate",
      label: "Portería",
      icon: ArrowRightLeft,
    },
    {
      id: "queue",
      label: `Rondas (${queueCount})`,
      icon: ClipboardList,
      relative: true,
      badge: hasUrgentQueue ? (
        <span className="w-2 h-2 rounded-full bg-amber-400 absolute top-2 right-2 animate-pulse" />
      ) : null,
    },
    {
      id: "inspection",
      label: "Inspección",
      icon: Radio,
    },
    {
      id: "incidents",
      label: `Incidentes (${incidentsCount})`,
      icon: AlertTriangle,
    },
    {
      id: "vehicles",
      label: "Vehículos",
      icon: Car,
    },
    {
      id: "dashboard",
      label: "Métricas",
      icon: ShieldCheck,
    },
    {
      id: "reports",
      label: "Reportes CSV",
      icon: FileSpreadsheet,
    },
  ];

  return (
    <div className="grid grid-cols-2 sm:grid-cols-4 md:grid-cols-7 gap-2">
      {tabs.map((tab) => {
        const Icon = tab.icon;
        const isActive = activeTab === tab.id;
        const baseClasses = tab.relative
          ? "flex items-center justify-center space-x-2 py-2.5 px-3 rounded-lg text-xs font-medium transition relative"
          : "flex items-center justify-center space-x-2 py-2.5 px-3 rounded-lg text-xs font-medium transition";
        const stateClasses = isActive
          ? "bg-emerald-600 text-white shadow"
          : "bg-slate-900 text-slate-300 hover:bg-slate-800 border border-slate-800";

        return (
          <button
            key={tab.id}
            type="button"
            onClick={() => onTabChange(tab.id)}
            className={`${baseClasses} ${stateClasses}`}
          >
            <Icon className="w-4 h-4" />
            <span>{tab.label}</span>
            {tab.badge}
          </button>
        );
      })}
    </div>
  );
}

export default DashboardNavigation;
