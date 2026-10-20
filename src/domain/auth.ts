// ParkCheck - Authentication & RBAC Middleware
// Specification Reference: Section 8, 12

import { NextRequest, NextResponse } from "next/server";
import jwt from "jsonwebtoken";
import { SiteRole } from "./types";

const SECRET = process.env.SESSION_SECRET || "fallback-secret-for-dev-only-min-32-chars";

export interface SessionPayload {
  userId: string;
  email: string;
  name: string;
  complexId: string;
  role: SiteRole;
}

export function signSessionToken(payload: SessionPayload): string {
  return jwt.sign(payload, SECRET, { expiresIn: "12h" });
}

export function verifySessionToken(token: string): SessionPayload | null {
  try {
    return jwt.verify(token, SECRET) as SessionPayload;
  } catch {
    return null;
  }
}

export function getSessionFromRequest(req: NextRequest): SessionPayload | null {
  const cookie = req.cookies.get("parkcheck_session")?.value;
  if (!cookie) return null;
  return verifySessionToken(cookie);
}

/**
 * Role-Based Access Control validator
 */
export const ROLE_PERMISSIONS: Record<SiteRole, {
  canRecordMovements: boolean;
  canPerformInspections: boolean;
  canReportIncidents: boolean;
  canManageIncidents: boolean;
  canManageComplexSettings: boolean;
  canExportReports: boolean;
}> = {
  ENTRANCE_GUARD: {
    canRecordMovements: true,
    canPerformInspections: false,
    canReportIncidents: true,
    canManageIncidents: false,
    canManageComplexSettings: false,
    canExportReports: false,
  },
  PARKING_GUARD: {
    canRecordMovements: false,
    canPerformInspections: true,
    canReportIncidents: true,
    canManageIncidents: false,
    canManageComplexSettings: false,
    canExportReports: false,
  },
  SUPERVISOR: {
    canRecordMovements: true,
    canPerformInspections: true,
    canReportIncidents: true,
    canManageIncidents: true,
    canManageComplexSettings: false,
    canExportReports: true,
  },
  RESIDENTIAL_ADMIN: {
    canRecordMovements: false,
    canPerformInspections: false,
    canReportIncidents: true,
    canManageIncidents: true,
    canManageComplexSettings: true,
    canExportReports: true,
  },
  PLATFORM_ADMIN: {
    canRecordMovements: true,
    canPerformInspections: true,
    canReportIncidents: true,
    canManageIncidents: true,
    canManageComplexSettings: true,
    canExportReports: true,
  },
};
