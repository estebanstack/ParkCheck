import React from "react";
import { IncidentStatusBadgeProps, IncidentStatusBadgeConfig } from "@/types/dashboard";

export function getIncidentStatusBadgeConfig(status: string): IncidentStatusBadgeConfig {
  switch (status) {
    case "REPORTED":
      return { label: "Reportado", bg: "bg-amber-950/80 text-amber-300 border-amber-800" };
    case "AWAITING_REVIEW":
      return { label: "En Revisión", bg: "bg-orange-950/80 text-orange-300 border-orange-800" };
    case "UNDER_INVESTIGATION":
      return { label: "En Investigación", bg: "bg-blue-950/80 text-blue-300 border-blue-800" };
    case "OWNER_CONTACT_PENDING":
      return { label: "Contacto Pendiente", bg: "bg-purple-950/80 text-purple-300 border-purple-800" };
    case "OWNER_CONTACTED":
      return { label: "Propietario Contactado", bg: "bg-cyan-950/80 text-cyan-300 border-cyan-800" };
    case "RESOLVED":
      return { label: "Resuelto", bg: "bg-emerald-950/80 text-emerald-300 border-emerald-800" };
    case "CLOSED":
      return { label: "Cerrado y Archivado", bg: "bg-slate-800 text-slate-300 border-slate-700" };
    default:
      return { label: status, bg: "bg-slate-800 text-slate-300 border-slate-700" };
  }
}

export function IncidentStatusBadge({
  status,
  size = "sm",
  className = "",
}: IncidentStatusBadgeProps) {
  const config = getIncidentStatusBadgeConfig(status);
  const sizeClasses =
    size === "md"
      ? "text-xs font-bold px-3 py-1 rounded-full border"
      : "text-[10px] font-bold px-2 py-0.5 rounded-full border";

  const fullClasses = className
    ? `${sizeClasses} ${config.bg} ${className}`
    : `${sizeClasses} ${config.bg}`;

  return <span className={fullClasses}>{config.label}</span>;
}

export default IncidentStatusBadge;
