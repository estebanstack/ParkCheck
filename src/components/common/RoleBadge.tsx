import React from "react";
import { RoleBadgeProps } from "@/types/dashboard";

export function RoleBadge({ role, className = "" }: RoleBadgeProps) {
  const combinedClassName = (baseClasses: string) =>
    className ? `${baseClasses} ${className}` : baseClasses;

  switch (role) {
    case "ENTRANCE_GUARD":
      return (
        <span
          className={combinedClassName(
            "bg-blue-900/60 text-blue-300 border border-blue-700 text-[11px] px-2 py-0.5 rounded-full font-medium"
          )}
        >
          Guarda de Portería
        </span>
      );
    case "PARKING_GUARD":
      return (
        <span
          className={combinedClassName(
            "bg-purple-900/60 text-purple-300 border border-purple-700 text-[11px] px-2 py-0.5 rounded-full font-medium"
          )}
        >
          Guarda Rondero
        </span>
      );
    case "SUPERVISOR":
      return (
        <span
          className={combinedClassName(
            "bg-amber-900/60 text-amber-300 border border-amber-700 text-[11px] px-2 py-0.5 rounded-full font-medium"
          )}
        >
          Supervisor de Seguridad
        </span>
      );
    case "RESIDENTIAL_ADMIN":
      return (
        <span
          className={combinedClassName(
            "bg-emerald-900/60 text-emerald-300 border border-emerald-700 text-[11px] px-2 py-0.5 rounded-full font-medium"
          )}
        >
          Administración
        </span>
      );
    case "PLATFORM_ADMIN":
      return (
        <span
          className={combinedClassName(
            "bg-rose-900/60 text-rose-300 border border-rose-700 text-[11px] px-2 py-0.5 rounded-full font-medium"
          )}
        >
          Super Admin Plataforma
        </span>
      );
    default:
      return (
        <span
          className={combinedClassName(
            "bg-slate-800 text-slate-300 text-[11px] px-2 py-0.5 rounded-full font-medium"
          )}
        >
          {role}
        </span>
      );
  }
}

export default RoleBadge;
