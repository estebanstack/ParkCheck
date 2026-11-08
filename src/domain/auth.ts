// ParkCheck - Authentication & RBAC Middleware
// Specification Reference: Section 8, 12

import { NextRequest } from "next/server";
import jwt from "jsonwebtoken";
import crypto from "crypto";
import { SiteRole } from "./types";

/**
 * Constant-time comparison to prevent timing side-channel attacks on secrets and tokens.
 */
export function timingSafeStringCompare(a: string, b: string): boolean {
  const bufA = Buffer.from(a, "utf-8");
  const bufB = Buffer.from(b, "utf-8");

  if (bufA.length !== bufB.length) {
    // Run dummy check against self to avoid leaking length differences via timing
    crypto.timingSafeEqual(bufA, bufA);
    return false;
  }

  return crypto.timingSafeEqual(bufA, bufB);
}

/**
 * Resolves the JWT signing and verification secret securely.
 *
 * Security Invariants:
 * 1. In production (NODE_ENV === "production"), SESSION_SECRET is strictly required
 *    and MUST be at least 32 characters long. If missing, empty, or too short,
 *    an explicit Error is thrown immediately. Never fall back to an insecure default in production.
 * 2. In non-production environments (test / development), SESSION_SECRET is used if present.
 *    If not set, an explicit dev-only secret is used so local development and test runs do not fail.
 */
export function getJwtSecret(): string {
  const secret = process.env.SESSION_SECRET?.trim();
  const isProduction = process.env.NODE_ENV === "production";

  if (!secret) {
    if (isProduction) {
      throw new Error(
        "CRITICAL SECURITY CONFIGURATION ERROR: SESSION_SECRET is required in production and must not be empty."
      );
    }
    return "parkcheck-dev-secret-minimum-32-chars-long-development-only";
  }

  if (isProduction && secret.length < 32) {
    throw new Error(
      "CRITICAL SECURITY CONFIGURATION ERROR: SESSION_SECRET in production must be at least 32 characters long."
    );
  }

  return secret;
}

export interface SessionPayload {
  userId: string;
  email: string;
  name: string;
  complexId: string;
  role: SiteRole;
}

export function signSessionToken(payload: SessionPayload): string {
  const secret = getJwtSecret();
  return jwt.sign(payload, secret, { expiresIn: "12h" });
}

export function verifySessionToken(token: string): SessionPayload | null {
  if (!token || typeof token !== "string" || !token.trim()) {
    return null;
  }
  try {
    const secret = getJwtSecret();
    return jwt.verify(token.trim(), secret) as SessionPayload;
  } catch {
    return null;
  }
}

export function getSessionFromRequest(req: NextRequest): SessionPayload | null {
  // 1. Check Bearer token in Authorization header (Android / Mobile clients)
  const authHeader = req.headers.get("authorization");
  if (authHeader && authHeader.startsWith("Bearer ")) {
    const token = authHeader.substring(7).trim();
    if (token) {
      const payload = verifySessionToken(token);
      if (payload) return payload;
    }
  }

  // 2. Fall back to cookie (Web dashboard / Next.js browser sessions)
  const cookie = req.cookies.get("parkcheck_session")?.value;
  if (!cookie || !cookie.trim()) return null;
  return verifySessionToken(cookie.trim());
}

/**
 * Validates scheduler / cron authorization headers.
 * Fails closed if the secret is absent, empty, or whitespace.
 */
export function verifySchedulerSecret(authHeader: string | null): boolean {
  if (!authHeader || typeof authHeader !== "string") {
    return false;
  }

  if (!authHeader.startsWith("Bearer ")) {
    return false;
  }

  const token = authHeader.substring(7).trim();
  if (!token) {
    return false;
  }

  // Dedicated scheduler secret if defined, else system session secret
  const configuredSecret = (
    process.env.CRON_SECRET ||
    process.env.SCHEDULER_SECRET ||
    process.env.SESSION_SECRET ||
    ""
  ).trim();

  // If secret is absent or empty, fail closed immediately
  if (!configuredSecret) {
    return false;
  }

  return timingSafeStringCompare(token, configuredSecret);
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

export function hasPermission(
  role: SiteRole,
  permission: keyof (typeof ROLE_PERMISSIONS)[SiteRole]
): boolean {
  return !!ROLE_PERMISSIONS[role]?.[permission];
}

/**
 * Validates request origin against Host / X-Forwarded-Host to protect cookie-authenticated state-changing mutations.
 * Bearer token requests (e.g. mobile app) are exempt since browsers do not send Bearer tokens automatically.
 */
export function validateCsrfOrigin(req: NextRequest): boolean {
  // Safe HTTP methods do not change state
  const safeMethods = ["GET", "HEAD", "OPTIONS"];
  if (safeMethods.includes(req.method.toUpperCase())) {
    return true;
  }

  // Bearer tokens (mobile client) are not subject to CSRF because browsers never attach them automatically
  const authHeader = req.headers.get("authorization");
  if (authHeader && authHeader.startsWith("Bearer ")) {
    return true;
  }

  // If request does not use the session cookie, CSRF is not applicable
  const sessionCookie = req.cookies.get("parkcheck_session")?.value;
  if (!sessionCookie) {
    return true;
  }

  const origin = req.headers.get("origin");
  const host = (req.headers.get("x-forwarded-host") || req.headers.get("host") || "").trim();

  // If origin is provided, it must match host
  if (origin) {
    try {
      const originUrl = new URL(origin);
      if (!host) {
        return false;
      }
      return originUrl.host.toLowerCase() === host.toLowerCase();
    } catch {
      return false;
    }
  }

  // If origin is absent, check referer header
  const referer = req.headers.get("referer");
  if (referer) {
    try {
      const refererUrl = new URL(referer);
      if (!host) {
        return false;
      }
      return refererUrl.host.toLowerCase() === host.toLowerCase();
    } catch {
      return false;
    }
  }

  // If neither origin nor referer is provided (e.g. non-browser direct clients or tests), allow
  return true;
}


