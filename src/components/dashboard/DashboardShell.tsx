import React from "react";
import { DashboardShellProps } from "@/types/dashboard";

export function DashboardShell({ header, navigation, children }: DashboardShellProps) {
  return (
    <div className="flex flex-col min-h-screen bg-slate-950 text-slate-100">
      {header}
      <main className="flex-1 p-4 sm:p-6 max-w-7xl mx-auto w-full space-y-6">
        {navigation}
        {children}
      </main>
    </div>
  );
}

export default DashboardShell;
