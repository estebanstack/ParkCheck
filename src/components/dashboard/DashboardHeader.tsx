"use client";

import React from "react";
import { ShieldCheck, LogOut } from "lucide-react";
import { DashboardHeaderProps } from "@/types/dashboard";
import { RoleBadge } from "@/components/common/RoleBadge";

export function DashboardHeader({ user, onLogout }: DashboardHeaderProps) {
  return (
    <header className="border-b border-slate-800 bg-slate-900/90 backdrop-blur sticky top-0 z-30 px-4 sm:px-6 py-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center space-x-3">
          <div className="w-10 h-10 rounded-xl bg-emerald-600 flex items-center justify-center text-white shadow-lg shadow-emerald-900/30">
            <ShieldCheck className="w-6 h-6" />
          </div>
          <div>
            <div className="flex items-center space-x-2">
              <span className="font-bold text-base tracking-wide text-white">ParkCheck</span>
              <span className="text-[10px] bg-slate-800 text-slate-300 px-1.5 py-0.5 rounded border border-slate-700 font-mono">
                FASE 2 REAL
              </span>
            </div>
            <p className="text-xs text-slate-400">
              Conjunto ID:{" "}
              <span className="font-mono text-slate-300">{user.complexId.slice(0, 12)}...</span>
            </p>
          </div>
        </div>

        {/* User profile & Logout */}
        <div className="flex items-center space-x-3">
          <div className="text-right hidden sm:block">
            <p className="text-xs font-semibold text-white">{user.name}</p>
            <div className="mt-0.5">
              <RoleBadge role={user.role} />
            </div>
          </div>
          <button
            onClick={onLogout}
            title="Cerrar sesión"
            className="flex items-center space-x-1.5 bg-slate-800 hover:bg-rose-950/80 hover:text-rose-300 hover:border-rose-700/80 text-slate-300 border border-slate-700 px-3 py-1.5 rounded-lg text-xs font-medium transition cursor-pointer"
          >
            <LogOut className="w-3.5 h-3.5" />
            <span>Salir</span>
          </button>
        </div>
      </div>
    </header>
  );
}

export default DashboardHeader;
