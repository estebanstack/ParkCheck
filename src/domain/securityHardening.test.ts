// ParkCheck - Phase 1: Security Hardening & Authentication Verification Tests
// Specification Reference: Section 8, 12, Phase 1 Security Hardening

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { NextRequest } from "next/server";
import {
  getJwtSecret,
  signSessionToken,
  verifySessionToken,
  verifySchedulerSecret,
  timingSafeStringCompare,
  validateCsrfOrigin,
  SessionPayload,
} from "./auth";

// Mock serverScheduler to prevent live PostgreSQL database requirement during route tests
vi.mock("@/domain/serverScheduler", () => ({
  executeComplexSchedulingTick: vi.fn().mockImplementation(async (complexId: string) => ({
    complexId,
    tickTimestamp: new Date().toISOString(),
    evaluatedOverdue: 2,
    generatedRounds: 1,
  })),
}));

import { POST as schedulerTickRoute } from "@/app/api/scheduler/tick/route";

describe("Phase 1 Security Hardening: JWT Secret & Configuration Invariants", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it("Throws explicit critical error in production when SESSION_SECRET is missing", () => {
    (process.env as Record<string, string | undefined>).NODE_ENV = "production";
    delete process.env.SESSION_SECRET;

    expect(() => getJwtSecret()).toThrow(
      /CRITICAL SECURITY CONFIGURATION ERROR: SESSION_SECRET is required in production/
    );
  });

  it("Throws explicit critical error in production when SESSION_SECRET is empty or whitespace", () => {
    (process.env as Record<string, string | undefined>).NODE_ENV = "production";
    process.env.SESSION_SECRET = "   ";

    expect(() => getJwtSecret()).toThrow(
      /CRITICAL SECURITY CONFIGURATION ERROR: SESSION_SECRET is required in production/
    );
  });

  it("Throws explicit critical error in production when SESSION_SECRET is shorter than 32 characters", () => {
    (process.env as Record<string, string | undefined>).NODE_ENV = "production";
    process.env.SESSION_SECRET = "too-short-secret-less-32";

    expect(() => getJwtSecret()).toThrow(
      /CRITICAL SECURITY CONFIGURATION ERROR: SESSION_SECRET in production must be at least 32 characters long/
    );
  });

  it("Succeeds in production when SESSION_SECRET meets the 32+ character requirement", () => {
    (process.env as Record<string, string | undefined>).NODE_ENV = "production";
    const validProdSecret = "production-cryptographic-secret-with-minimum-32-chars-entropy";
    process.env.SESSION_SECRET = validProdSecret;

    expect(getJwtSecret()).toBe(validProdSecret);
  });

  it("Falls back to explicit development key only in non-production environments when secret is unset", () => {
    (process.env as Record<string, string | undefined>).NODE_ENV = "test";
    delete process.env.SESSION_SECRET;

    const devSecret = getJwtSecret();
    expect(devSecret).toBe("parkcheck-dev-secret-minimum-32-chars-long-development-only");
  });

  it("Respects configured SESSION_SECRET in development/test environments", () => {
    (process.env as Record<string, string | undefined>).NODE_ENV = "test";
    process.env.SESSION_SECRET = "custom-test-session-secret-key-12345";

    expect(getJwtSecret()).toBe("custom-test-session-secret-key-12345");
  });
});

describe("Phase 1 Security Hardening: Token Issuance & Verification", () => {
  const sampleSession: SessionPayload = {
    userId: "usr-sec-001",
    email: "guard@parkcheck.internal",
    name: "Agente de Guardia",
    complexId: "comp-sec-bosque",
    role: "ENTRANCE_GUARD",
  };

  it("Signs and verifies a legitimate session token preserving all claims", () => {
    process.env.SESSION_SECRET = "secure-jwt-signing-key-for-unit-testing-32-chars";
    const token = signSessionToken(sampleSession);
    expect(typeof token).toBe("string");

    const verified = verifySessionToken(token);
    expect(verified).not.toBeNull();
    expect(verified?.userId).toBe(sampleSession.userId);
    expect(verified?.email).toBe(sampleSession.email);
    expect(verified?.name).toBe(sampleSession.name);
    expect(verified?.complexId).toBe(sampleSession.complexId);
    expect(verified?.role).toBe(sampleSession.role);
  });

  it("Rejects tampered tokens (fails closed)", () => {
    process.env.SESSION_SECRET = "secure-jwt-signing-key-for-unit-testing-32-chars";
    const validToken = signSessionToken(sampleSession);
    const tamperedToken = validToken.slice(0, -6) + "xxxxxx";

    expect(verifySessionToken(tamperedToken)).toBeNull();
  });

  it("Rejects tokens signed with a different secret", () => {
    process.env.SESSION_SECRET = "secret-key-alpha-minimum-32-characters-long";
    const token = signSessionToken(sampleSession);

    // Verify with a different secret
    process.env.SESSION_SECRET = "secret-key-bravo-minimum-32-characters-long";
    expect(verifySessionToken(token)).toBeNull();
  });

  it("Fails closed on empty, null, or malformed token inputs", () => {
    expect(verifySessionToken("")).toBeNull();
    expect(verifySessionToken("   ")).toBeNull();
    expect(verifySessionToken("not-a-valid-jwt")).toBeNull();
    // @ts-expect-error - testing invalid input types
    expect(verifySessionToken(null)).toBeNull();
    // @ts-expect-error - testing invalid input types
    expect(verifySessionToken(undefined)).toBeNull();
  });

  it("In production: signSessionToken fails explicitly if production secret is missing", () => {
    const originalEnv = { ...process.env };
    (process.env as Record<string, string | undefined>).NODE_ENV = "production";
    delete process.env.SESSION_SECRET;

    expect(() => signSessionToken(sampleSession)).toThrow(
      /CRITICAL SECURITY CONFIGURATION ERROR/
    );

    // verifySessionToken fails closed (returns null)
    expect(verifySessionToken("dummy-token")).toBeNull();

    process.env = originalEnv;
  });
});

describe("Phase 1 Security Hardening: Scheduler Secret Validation Helper", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it("Constant-time string comparison verifies identical strings and rejects mismatches safely", () => {
    expect(timingSafeStringCompare("hello-world-1234", "hello-world-1234")).toBe(true);
    expect(timingSafeStringCompare("hello-world-1234", "hello-world-9999")).toBe(false);
    expect(timingSafeStringCompare("short", "much-longer-string")).toBe(false);
    expect(timingSafeStringCompare("", "")).toBe(true);
  });

  it("Fails closed when secret is not configured, empty, or whitespace", () => {
    delete process.env.CRON_SECRET;
    delete process.env.SCHEDULER_SECRET;
    delete process.env.SESSION_SECRET;

    // Header attempting to exploit 'Bearer undefined'
    expect(verifySchedulerSecret("Bearer undefined")).toBe(false);
    expect(verifySchedulerSecret("Bearer ")).toBe(false);
    expect(verifySchedulerSecret("Bearer null")).toBe(false);

    // Explicitly empty secret
    process.env.SESSION_SECRET = "";
    expect(verifySchedulerSecret("Bearer ")).toBe(false);

    process.env.SESSION_SECRET = "    ";
    expect(verifySchedulerSecret("Bearer     ")).toBe(false);
  });

  it("Rejects missing, malformed, or empty headers", () => {
    process.env.SESSION_SECRET = "valid-scheduler-secret-32-chars-long";

    expect(verifySchedulerSecret(null)).toBe(false);
    expect(verifySchedulerSecret("")).toBe(false);
    expect(verifySchedulerSecret("Basic valid-scheduler-secret-32-chars-long")).toBe(false);
    expect(verifySchedulerSecret("Bearer")).toBe(false);
    expect(verifySchedulerSecret("Bearer ")).toBe(false);
  });

  it("Rejects incorrect credentials", () => {
    process.env.SESSION_SECRET = "valid-scheduler-secret-32-chars-long";

    expect(verifySchedulerSecret("Bearer wrong-secret-value-attempt")).toBe(false);
    expect(verifySchedulerSecret("Bearer valid-scheduler-secret-32-chars-lonx")).toBe(false);
  });

  it("Accepts valid credentials matching SESSION_SECRET", () => {
    const secret = "valid-scheduler-secret-32-chars-long";
    process.env.SESSION_SECRET = secret;

    expect(verifySchedulerSecret(`Bearer ${secret}`)).toBe(true);
  });

  it("Prefers CRON_SECRET or SCHEDULER_SECRET if explicitly configured", () => {
    process.env.SESSION_SECRET = "system-session-secret-32-chars-long";
    process.env.SCHEDULER_SECRET = "dedicated-scheduler-secret-key-32";

    // Should accept dedicated scheduler secret
    expect(verifySchedulerSecret("Bearer dedicated-scheduler-secret-key-32")).toBe(true);
  });
});

describe("Phase 1 Security Hardening: Scheduler Tick Route Regression Tests (/api/scheduler/tick)", () => {
  const originalEnv = { ...process.env };
  const validSecret = "secure-scheduler-secret-minimum-32-chars";

  beforeEach(() => {
    process.env = { ...originalEnv };
    process.env.SESSION_SECRET = validSecret;
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it("Fails closed (401) when configuration is missing and request attempts 'Bearer undefined'", async () => {
    delete process.env.CRON_SECRET;
    delete process.env.SCHEDULER_SECRET;
    delete process.env.SESSION_SECRET;

    const req = new NextRequest("http://localhost:3000/api/scheduler/tick", {
      method: "POST",
      headers: {
        authorization: "Bearer undefined",
        "content-type": "application/json",
      },
      body: JSON.stringify({ complexId: "comp-1" }),
    });

    const res = await schedulerTickRoute(req);
    expect(res.status).toBe(401);

    const data = await res.json();
    expect(data.error).toBe("No autorizado");
  });

  it("Fails closed (401) when no authorization credentials are provided", async () => {
    const req = new NextRequest("http://localhost:3000/api/scheduler/tick", {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify({ complexId: "comp-1" }),
    });

    const res = await schedulerTickRoute(req);
    expect(res.status).toBe(401);
  });

  it("Fails closed (401) when incorrect credentials are provided", async () => {
    const req = new NextRequest("http://localhost:3000/api/scheduler/tick", {
      method: "POST",
      headers: {
        authorization: "Bearer attacker-invalid-token",
        "content-type": "application/json",
      },
      body: JSON.stringify({ complexId: "comp-1" }),
    });

    const res = await schedulerTickRoute(req);
    expect(res.status).toBe(401);
  });

  it("Fails closed (401) when authorization scheme is malformed", async () => {
    const req = new NextRequest("http://localhost:3000/api/scheduler/tick", {
      method: "POST",
      headers: {
        authorization: `Token ${validSecret}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ complexId: "comp-1" }),
    });

    const res = await schedulerTickRoute(req);
    expect(res.status).toBe(401);
  });

  it("Rejects guard user session with 403 Forbidden", async () => {
    const guardToken = signSessionToken({
      userId: "guard-123",
      email: "guard@complex.com",
      name: "Guarda Rondas",
      complexId: "comp-1",
      role: "PARKING_GUARD",
    });

    const req = new NextRequest("http://localhost:3000/api/scheduler/tick", {
      method: "POST",
      headers: {
        authorization: `Bearer ${guardToken}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ complexId: "comp-1" }),
    });

    const res = await schedulerTickRoute(req);
    expect(res.status).toBe(403);
    const data = await res.json();
    expect(data.error).toContain("permisos insuficientes");
  });

  it("Rejects cross-complex execution by non-platform-admin supervisor with 403 Forbidden", async () => {
    const supervisorToken = signSessionToken({
      userId: "supervisor-123",
      email: "supervisor@complex.com",
      name: "Supervisor Luis",
      complexId: "comp-alpha",
      role: "SUPERVISOR",
    });

    const req = new NextRequest("http://localhost:3000/api/scheduler/tick", {
      method: "POST",
      headers: {
        authorization: `Bearer ${supervisorToken}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ complexId: "comp-bravo-forbidden" }),
    });

    const res = await schedulerTickRoute(req);
    expect(res.status).toBe(403);
    const data = await res.json();
    expect(data.error).toContain("no autorizado para ejecutar programación en este conjunto");
  });

  it("Rejects authorized request if complexId is missing", async () => {
    const req = new NextRequest("http://localhost:3000/api/scheduler/tick", {
      method: "POST",
      headers: {
        authorization: `Bearer ${validSecret}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({}),
    });

    const res = await schedulerTickRoute(req);
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error).toBe("complexId requerido");
  });

  it("Accepts valid cron authorization with complexId and executes tick", async () => {
    const req = new NextRequest("http://localhost:3000/api/scheduler/tick", {
      method: "POST",
      headers: {
        authorization: `Bearer ${validSecret}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ complexId: "comp-1" }),
    });

    const res = await schedulerTickRoute(req);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.success).toBe(true);
    expect(data.result).toBeDefined();
    expect(data.result.complexId).toBe("comp-1");
  });

  it("Accepts valid Supervisor session for their complex and defaults complexId from session", async () => {
    const supervisorToken = signSessionToken({
      userId: "supervisor-456",
      email: "supervisor@bosque.com",
      name: "Supervisor Carlos",
      complexId: "comp-bosque-real",
      role: "SUPERVISOR",
    });

    const req = new NextRequest("http://localhost:3000/api/scheduler/tick", {
      method: "POST",
      headers: {
        authorization: `Bearer ${supervisorToken}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({}),
    });

    const res = await schedulerTickRoute(req);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.success).toBe(true);
    expect(data.result.complexId).toBe("comp-bosque-real");
  });

  it("Accepts valid PLATFORM_ADMIN session executing for any specified complex", async () => {
    const adminToken = signSessionToken({
      userId: "admin-platform",
      email: "admin@parkcheck.app",
      name: "Platform Super Admin",
      complexId: "comp-platform",
      role: "PLATFORM_ADMIN",
    });

    const req = new NextRequest("http://localhost:3000/api/scheduler/tick", {
      method: "POST",
      headers: {
        authorization: `Bearer ${adminToken}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ complexId: "comp-target-anywhere" }),
    });

    const res = await schedulerTickRoute(req);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.success).toBe(true);
    expect(data.result.complexId).toBe("comp-target-anywhere");
  });
});

describe("Phase 1 & 2 Security Hardening: CSRF & Origin Boundary Protection", () => {
  it("Allows safe HTTP methods (GET, HEAD, OPTIONS) unconditionally", () => {
    const req = new NextRequest("http://localhost:3000/api/vehicles", {
      method: "GET",
      headers: {
        origin: "https://evil-cross-origin.com",
        host: "localhost:3000",
        cookie: "parkcheck_session=some-jwt-token",
      },
    });

    expect(validateCsrfOrigin(req)).toBe(true);
  });

  it("Allows Bearer-authenticated requests regardless of origin (mobile app compatibility)", () => {
    const req = new NextRequest("http://localhost:3000/api/movements/record", {
      method: "POST",
      headers: {
        authorization: "Bearer mobile-client-jwt-token",
        origin: "https://evil-cross-origin.com",
        host: "localhost:3000",
      },
    });

    expect(validateCsrfOrigin(req)).toBe(true);
  });

  it("Allows requests when no session cookie is present (e.g. unauthenticated calls handled by 401)", () => {
    const req = new NextRequest("http://localhost:3000/api/movements/record", {
      method: "POST",
      headers: {
        origin: "https://evil-cross-origin.com",
        host: "localhost:3000",
      },
    });

    expect(validateCsrfOrigin(req)).toBe(true);
  });

  it("Allows cookie-authenticated mutation when Origin matches Host", () => {
    const req = new NextRequest("http://localhost:3000/api/movements/record", {
      method: "POST",
      headers: {
        origin: "http://localhost:3000",
        host: "localhost:3000",
        cookie: "parkcheck_session=valid-cookie-token",
      },
    });

    expect(validateCsrfOrigin(req)).toBe(true);
  });

  it("Blocks cookie-authenticated mutation when Origin does not match Host (CSRF attempt)", () => {
    const req = new NextRequest("http://localhost:3000/api/movements/record", {
      method: "POST",
      headers: {
        origin: "https://attacker-domain.xyz",
        host: "localhost:3000",
        cookie: "parkcheck_session=valid-cookie-token",
      },
    });

    expect(validateCsrfOrigin(req)).toBe(false);
  });

  it("Blocks cookie-authenticated mutation when Referer does not match Host", () => {
    const req = new NextRequest("http://localhost:3000/api/movements/record", {
      method: "POST",
      headers: {
        referer: "https://attacker-domain.xyz/attack-page",
        host: "localhost:3000",
        cookie: "parkcheck_session=valid-cookie-token",
      },
    });

    expect(validateCsrfOrigin(req)).toBe(false);
  });

  it("Allows cookie-authenticated mutation when Referer matches Host and Origin is absent", () => {
    const req = new NextRequest("http://localhost:3000/api/movements/record", {
      method: "POST",
      headers: {
        referer: "http://localhost:3000/dashboard",
        host: "localhost:3000",
        cookie: "parkcheck_session=valid-cookie-token",
      },
    });

    expect(validateCsrfOrigin(req)).toBe(true);
  });
});

