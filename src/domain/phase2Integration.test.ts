// ParkCheck - Phase 2: Web Authentication & Backend Integration Tests
// Specification Reference: Phase 2 Workstreams A, B, C, D, E

import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import {
  signSessionToken,
  verifySessionToken,
  getSessionFromRequest,
  ROLE_PERMISSIONS,
  hasPermission,
  SessionPayload,
} from "./auth";
import { POST as logoutRoute, GET as sessionCheckRoute } from "@/app/api/auth/session/route";
import { GET as getVehiclesRoute } from "@/app/api/vehicles/route";

// Mock serverScheduler and prisma using vi.hoisted to permit hoisting
const { mockPrisma } = vi.hoisted(() => {
  const mockPrisma = {
    vehicle: {
      findMany: vi.fn(),
      count: vi.fn(),
      findFirst: vi.fn(),
      findUnique: vi.fn(),
      create: vi.fn(),
    },
    vehicleMovementEvent: {
      findFirst: vi.fn(),
      create: vi.fn(),
    },
    vehiclePresence: {
      create: vi.fn(),
      upsert: vi.fn(),
      count: vi.fn(),
    },
    inspectionTask: {
      findMany: vi.fn(),
      findUniqueOrThrow: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      count: vi.fn(),
    },
    inspectionRecord: {
      create: vi.fn(),
    },
    incident: {
      create: vi.fn(),
      count: vi.fn(),
    },
    incidentFollowUp: {
      create: vi.fn(),
    },
    notification: {
      create: vi.fn(),
    },
    auditLog: {
      create: vi.fn(),
    },
    residentialComplex: {
      findUniqueOrThrow: vi.fn(),
    },
    user: {
      findUnique: vi.fn(),
    },
    $transaction: vi.fn((callback) => callback(mockPrisma)),
  };

  return { mockPrisma };
});

vi.mock("@/domain/serverScheduler", () => ({
  prisma: mockPrisma,
  executeComplexSchedulingTick: vi.fn(),
}));

describe("Phase 2 - Workstream A: Web Authentication & Session Management", () => {
  const supervisorSession: SessionPayload = {
    userId: "usr-sup-01",
    email: "supervisor@seguridadcolombia.com",
    name: "Mayor Luis Restrepo",
    complexId: "comp-bosque-01",
    role: "SUPERVISOR",
  };

  const guardSession: SessionPayload = {
    userId: "usr-grd-01",
    email: "porteria@bosquereal.com",
    name: "Carlos Mendoza",
    complexId: "comp-bosque-01",
    role: "ENTRANCE_GUARD",
  };

  const ronderoSession: SessionPayload = {
    userId: "usr-rnd-01",
    email: "rondas@bosquereal.com",
    name: "Jhonatan Pérez",
    complexId: "comp-bosque-01",
    role: "PARKING_GUARD",
  };

  it("Clears session cookie on logout (POST /api/auth/session)", async () => {
    const req = new NextRequest("http://localhost:3000/api/auth/session", {
      method: "POST",
    });

    const res = await logoutRoute(req);
    expect(res.status).toBe(200);

    const data = await res.json();
    expect(data.success).toBe(true);

    const setCookie = res.headers.get("set-cookie");
    expect(setCookie).toBeDefined();
    // Cookie is deleted (expired or max-age=0)
    expect(setCookie).toMatch(/parkcheck_session=;.*(Expires|Max-Age=0)/i);
  });

  it("Rejects unauthenticated session validation (GET /api/auth/session)", async () => {
    const req = new NextRequest("http://localhost:3000/api/auth/session", {
      method: "GET",
    });

    const res = await sessionCheckRoute(req);
    expect(res.status).toBe(401);

    const data = await res.json();
    expect(data.authenticated).toBe(false);
  });

  it("Validates legitimate cookie session (GET /api/auth/session)", async () => {
    const token = signSessionToken(supervisorSession);
    const req = new NextRequest("http://localhost:3000/api/auth/session", {
      method: "GET",
      headers: {
        cookie: `parkcheck_session=${token}`,
      },
    });

    const res = await sessionCheckRoute(req);
    expect(res.status).toBe(200);

    const data = await res.json();
    expect(data.authenticated).toBe(true);
    expect(data.session.userId).toBe(supervisorSession.userId);
    expect(data.session.role).toBe("SUPERVISOR");
    expect(data.session.complexId).toBe("comp-bosque-01");
  });

  it("Extracts session payload from Bearer header or cookie", () => {
    const token = signSessionToken(guardSession);

    // Header test
    const reqHeader = new NextRequest("http://localhost:3000/api/vehicles", {
      headers: { authorization: `Bearer ${token}` },
    });
    const sessionFromHeader = getSessionFromRequest(reqHeader);
    expect(sessionFromHeader?.userId).toBe(guardSession.userId);

    // Cookie test
    const reqCookie = new NextRequest("http://localhost:3000/api/vehicles", {
      headers: { cookie: `parkcheck_session=${token}` },
    });
    const sessionFromCookie = getSessionFromRequest(reqCookie);
    expect(sessionFromCookie?.userId).toBe(guardSession.userId);
  });

  it("Strictly enforces role-based permission boundaries", () => {
    // ENTRANCE_GUARD
    expect(hasPermission("ENTRANCE_GUARD", "canRecordMovements")).toBe(true);
    expect(hasPermission("ENTRANCE_GUARD", "canPerformInspections")).toBe(false);
    expect(hasPermission("ENTRANCE_GUARD", "canManageIncidents")).toBe(false);
    expect(hasPermission("ENTRANCE_GUARD", "canExportReports")).toBe(false);

    // PARKING_GUARD
    expect(hasPermission("PARKING_GUARD", "canRecordMovements")).toBe(false);
    expect(hasPermission("PARKING_GUARD", "canPerformInspections")).toBe(true);
    expect(hasPermission("PARKING_GUARD", "canManageIncidents")).toBe(false);

    // SUPERVISOR
    expect(hasPermission("SUPERVISOR", "canRecordMovements")).toBe(true);
    expect(hasPermission("SUPERVISOR", "canPerformInspections")).toBe(true);
    expect(hasPermission("SUPERVISOR", "canManageIncidents")).toBe(true);
    expect(hasPermission("SUPERVISOR", "canExportReports")).toBe(true);

    // RESIDENTIAL_ADMIN
    expect(hasPermission("RESIDENTIAL_ADMIN", "canRecordMovements")).toBe(false);
    expect(hasPermission("RESIDENTIAL_ADMIN", "canManageComplexSettings")).toBe(true);
    expect(hasPermission("RESIDENTIAL_ADMIN", "canExportReports")).toBe(true);
  });
});

describe("Phase 2 - Workstream D: Real Vehicle Registry API (GET /api/vehicles)", () => {
  const compASession: SessionPayload = {
    userId: "usr-comp-a",
    email: "guard@comp-a.com",
    name: "Guarda A",
    complexId: "complex-alpha-100",
    role: "ENTRANCE_GUARD",
  };

  const compBSession: SessionPayload = {
    userId: "usr-comp-b",
    email: "guard@comp-b.com",
    name: "Guarda B",
    complexId: "complex-beta-200",
    role: "ENTRANCE_GUARD",
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("Rejects unauthenticated requests with 401", async () => {
    const req = new NextRequest("http://localhost:3000/api/vehicles", {
      method: "GET",
    });

    const res = await getVehiclesRoute(req);
    expect(res.status).toBe(401);

    const data = await res.json();
    expect(data.error).toMatch(/No autenticado/);
  });

  it("Enforces strict residential-complex isolation: Complex A cannot see Complex B records", async () => {
    mockPrisma.vehicle.count.mockResolvedValueOnce(2);
    mockPrisma.vehicle.findMany.mockResolvedValueOnce([
      {
        id: "veh-a-1",
        complexId: "complex-alpha-100",
        plate: "KHY842",
        parkingSpace: "Torre 1 - 102",
        stickerToken: "NFC-01",
        createdAt: new Date("2026-10-20T10:00:00Z"),
        presence: { currentStatus: "INSIDE", verificationDetails: null },
      },
      {
        id: "veh-a-2",
        complexId: "complex-alpha-100",
        plate: "WLU915",
        parkingSpace: "Torre 2 - 205",
        stickerToken: "NFC-02",
        createdAt: new Date("2026-10-21T10:00:00Z"),
        presence: { currentStatus: "AWAY", verificationDetails: null },
      },
    ]);

    const token = signSessionToken(compASession);
    const req = new NextRequest("http://localhost:3000/api/vehicles", {
      method: "GET",
      headers: { cookie: `parkcheck_session=${token}` },
    });

    const res = await getVehiclesRoute(req);
    expect(res.status).toBe(200);

    const data = await res.json();
    expect(data.success).toBe(true);
    expect(data.vehicles.length).toBe(2);
    expect(data.vehicles[0].plate).toBe("KHY842");

    // Verify Prisma was called strictly with Complex A's ID
    expect(mockPrisma.vehicle.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          complexId: "complex-alpha-100",
          active: true,
        }),
      })
    );
  });

  it("Supports search by license plate and parking unit with pagination", async () => {
    mockPrisma.vehicle.count.mockResolvedValueOnce(1);
    mockPrisma.vehicle.findMany.mockResolvedValueOnce([
      {
        id: "veh-a-1",
        complexId: "complex-alpha-100",
        plate: "KHY842",
        parkingSpace: "Torre 1 - 102",
        stickerToken: "NFC-01",
        createdAt: new Date(),
        presence: { currentStatus: "INSIDE", verificationDetails: null },
      },
    ]);

    const token = signSessionToken(compASession);
    const req = new NextRequest(
      "http://localhost:3000/api/vehicles?search=KHY&page=2&limit=5",
      {
        method: "GET",
        headers: { cookie: `parkcheck_session=${token}` },
      }
    );

    const res = await getVehiclesRoute(req);
    expect(res.status).toBe(200);

    const data = await res.json();
    expect(data.pagination.page).toBe(2);
    expect(data.pagination.limit).toBe(5);
    expect(data.pagination.total).toBe(1);

    // Verify skip calculation: (page 2 - 1) * 5 = 5
    expect(mockPrisma.vehicle.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        skip: 5,
        take: 5,
        where: expect.objectContaining({
          complexId: "complex-alpha-100",
          OR: expect.arrayContaining([
            expect.objectContaining({ plate: { contains: "KHY" } }),
          ]),
        }),
      })
    );
  });

  it("Handles empty results gracefully without errors", async () => {
    mockPrisma.vehicle.count.mockResolvedValueOnce(0);
    mockPrisma.vehicle.findMany.mockResolvedValueOnce([]);

    const token = signSessionToken(compBSession);
    const req = new NextRequest(
      "http://localhost:3000/api/vehicles?search=NONEXISTENT",
      {
        method: "GET",
        headers: { cookie: `parkcheck_session=${token}` },
      }
    );

    const res = await getVehiclesRoute(req);
    expect(res.status).toBe(200);

    const data = await res.json();
    expect(data.success).toBe(true);
    expect(data.vehicles).toEqual([]);
    expect(data.pagination.total).toBe(0);
    expect(data.pagination.totalPages).toBe(1);
  });
});

describe("Phase 2 - Workstream B: Movement Endpoints & Deduplication Protection", () => {
  const complexPolicy = {
    inspectionIntervalMinutes: 60,
    overdueGraceMinutes: 15,
    returnSatisfiesScheduledPolicy: "NEVER",
    returnWindowMinutes: 30,
    departureWithPendingTaskPolicy: "FLAG_FOR_SUPERVISOR_REVIEW",
    queueAlertOrderPolicy: "RETURN_FIRST_ALERTS_PINNED",
    overdueEscalationMinutes: 30,
    movementDedupSeconds: 60,
    retentionDaysPhotos: 365,
    retentionDaysRecords: 365,
  };

  it("Rejects duplicate movements within the cooldown period with 409", async () => {
    const { POST: recordMovementRoute } = await import(
      "@/app/api/movements/record/route"
    );

    const guardSession: SessionPayload = {
      userId: "usr-grd-01",
      email: "porteria@bosquereal.com",
      name: "Carlos Mendoza",
      complexId: "comp-bosque-01",
      role: "ENTRANCE_GUARD",
    };

    const token = signSessionToken(guardSession);
    const recentDate = new Date(); // Within 60 seconds

    mockPrisma.vehicle.findUnique.mockResolvedValueOnce({
      id: "veh-dup-01",
      plate: "ABC123",
      complexId: "comp-bosque-01",
      presence: { currentStatus: "INSIDE" },
    });

    mockPrisma.residentialComplex.findUniqueOrThrow.mockResolvedValueOnce({
      id: "comp-bosque-01",
      ...complexPolicy,
    });

    mockPrisma.vehicleMovementEvent.findFirst.mockResolvedValueOnce({
      id: "mov-prev-01",
      complexId: "comp-bosque-01",
      vehicleId: "veh-dup-01",
      eventType: "ARRIVAL",
      recordedAt: recentDate,
      source: "GATE_MANUAL",
    });

    const req = new NextRequest("http://localhost:3000/api/movements/record", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        cookie: `parkcheck_session=${token}`,
      },
      body: JSON.stringify({
        plate: "ABC123",
        eventType: "ARRIVAL",
      }),
    });

    const res = await recordMovementRoute(req);
    expect(res.status).toBe(409);

    const data = await res.json();
    expect(data.duplicate).toBe(true);
    expect(data.error).toMatch(/Movimiento duplicado ignorado/);
  });

  it("Rejects movement registration by unauthorized role (PARKING_GUARD) with 403 Forbidden", async () => {
    const { POST: recordMovementRoute } = await import(
      "@/app/api/movements/record/route"
    );

    const ronderoSession: SessionPayload = {
      userId: "usr-rnd-01",
      email: "rondas@bosquereal.com",
      name: "Jhonatan Pérez",
      complexId: "comp-bosque-01",
      role: "PARKING_GUARD", // Lacks canRecordMovements
    };

    const token = signSessionToken(ronderoSession);
    const req = new NextRequest("http://localhost:3000/api/movements/record", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        cookie: `parkcheck_session=${token}`,
      },
      body: JSON.stringify({
        plate: "ABC123",
        eventType: "ARRIVAL",
      }),
    });

    const res = await recordMovementRoute(req);
    expect(res.status).toBe(403);

    const data = await res.json();
    expect(data.error).toMatch(/Acceso denegado.*no tiene permisos para registrar movimientos/);
  });

  it("Blocks cross-origin CSRF movement mutation with 403 Forbidden", async () => {
    const { POST: recordMovementRoute } = await import(
      "@/app/api/movements/record/route"
    );

    const guardSession: SessionPayload = {
      userId: "usr-grd-01",
      email: "porteria@bosquereal.com",
      name: "Carlos Mendoza",
      complexId: "comp-bosque-01",
      role: "ENTRANCE_GUARD",
    };

    const token = signSessionToken(guardSession);
    const req = new NextRequest("http://localhost:3000/api/movements/record", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        cookie: `parkcheck_session=${token}`,
        origin: "https://malicious-cross-origin.com",
        host: "localhost:3000",
      },
      body: JSON.stringify({
        plate: "ABC123",
        eventType: "ARRIVAL",
      }),
    });

    const res = await recordMovementRoute(req);
    expect(res.status).toBe(403);

    const data = await res.json();
    expect(data.error).toMatch(/protección CSRF/);
  });
});

describe("Phase 2 - Workstream C: Inspections Queue & Task Prioritization", () => {
  it("GET /api/inspections/queue rejects unauthenticated requests with 401", async () => {
    const { GET: getQueueRoute } = await import(
      "@/app/api/inspections/queue/route"
    );

    const req = new NextRequest("http://localhost:3000/api/inspections/queue", {
      method: "GET",
    });

    const res = await getQueueRoute(req);
    expect(res.status).toBe(401);
  });

  it("POST /api/inspections/submit denies cross-tenant inspection submission with 403", async () => {
    const { POST: submitInspectionRoute } = await import(
      "@/app/api/inspections/submit/route"
    );

    const ronderoSession: SessionPayload = {
      userId: "usr-rnd-01",
      email: "rondas@bosquereal.com",
      name: "Jhonatan Pérez",
      complexId: "comp-bosque-01", // Belongs to Bosque Real
      role: "PARKING_GUARD",
    };

    const token = signSessionToken(ronderoSession);

    // Mock task belonging to a DIFFERENT complex
    mockPrisma.inspectionTask.findUniqueOrThrow.mockResolvedValueOnce({
      id: "task-other-complex",
      complexId: "comp-different-complex-999", // Different complex!
      vehicleId: "veh-999",
      triggerType: "RETURN",
      status: "PENDING",
      dueAt: new Date(),
      createdAt: new Date(),
      updatedAt: new Date(),
      vehicle: { plate: "XYZ789" },
    });

    const req = new NextRequest("http://localhost:3000/api/inspections/submit", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        cookie: `parkcheck_session=${token}`,
      },
      body: JSON.stringify({
        taskId: "task-other-complex",
        result: "NO_VISIBLE_INCIDENT",
      }),
    });

    const res = await submitInspectionRoute(req);
    expect(res.status).toBe(403);

    const data = await res.json();
    expect(data.error).toMatch(/No autorizado para este conjunto residencial/);
  });

  it("Submitting DAMAGE_OBSERVED creates Incident, Notification, and FollowUp audit", async () => {
    const { POST: submitInspectionRoute } = await import(
      "@/app/api/inspections/submit/route"
    );

    const ronderoSession: SessionPayload = {
      userId: "usr-rnd-01",
      email: "rondas@bosquereal.com",
      name: "Jhonatan Pérez",
      complexId: "comp-bosque-01",
      role: "PARKING_GUARD",
    };

    const token = signSessionToken(ronderoSession);

    mockPrisma.inspectionTask.findUniqueOrThrow.mockResolvedValueOnce({
      id: "task-dmg-01",
      complexId: "comp-bosque-01",
      vehicleId: "veh-dmg-01",
      triggerType: "RETURN",
      status: "PENDING",
      dueAt: new Date(),
      createdAt: new Date(),
      updatedAt: new Date(),
      vehicle: { plate: "KHY842" },
    });

    mockPrisma.inspectionTask.update.mockResolvedValueOnce({});
    mockPrisma.inspectionRecord.create.mockResolvedValueOnce({
      id: "rec-dmg-01",
      complexId: "comp-bosque-01",
      vehicleId: "veh-dmg-01",
      taskId: "task-dmg-01",
      result: "DAMAGE_OBSERVED",
      description: "Raspón lateral izquierdo",
    });

    mockPrisma.incident.create.mockResolvedValueOnce({
      id: "inc-new-001",
      complexId: "comp-bosque-01",
      vehicleId: "veh-dmg-01",
      status: "REPORTED",
      description: "Raspón lateral izquierdo",
    });

    mockPrisma.incidentFollowUp.create.mockResolvedValueOnce({});
    mockPrisma.notification.create.mockResolvedValue({});

    const req = new NextRequest("http://localhost:3000/api/inspections/submit", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        cookie: `parkcheck_session=${token}`,
      },
      body: JSON.stringify({
        taskId: "task-dmg-01",
        result: "DAMAGE_OBSERVED",
        description: "Raspón lateral izquierdo",
        surveillanceRequired: true,
        ownerContactRequired: true,
      }),
    });

    const res = await submitInspectionRoute(req);
    expect(res.status).toBe(200);

    const data = await res.json();
    expect(data.success).toBe(true);
    expect(data.incident).toBeDefined();
    expect(data.incident.id).toBe("inc-new-001");
    expect(mockPrisma.incident.create).toHaveBeenCalled();
    expect(mockPrisma.notification.create).toHaveBeenCalled();
  });

  it("Rejects inspection submission by unauthorized role (ENTRANCE_GUARD) with 403 Forbidden", async () => {
    const { POST: submitInspectionRoute } = await import(
      "@/app/api/inspections/submit/route"
    );

    const guardSession: SessionPayload = {
      userId: "usr-grd-01",
      email: "porteria@bosquereal.com",
      name: "Carlos Mendoza",
      complexId: "comp-bosque-01",
      role: "ENTRANCE_GUARD", // Lacks canPerformInspections
    };

    const token = signSessionToken(guardSession);
    const req = new NextRequest("http://localhost:3000/api/inspections/submit", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        cookie: `parkcheck_session=${token}`,
      },
      body: JSON.stringify({
        taskId: "task-001",
        result: "NO_VISIBLE_INCIDENT",
      }),
    });

    const res = await submitInspectionRoute(req);
    expect(res.status).toBe(403);

    const data = await res.json();
    expect(data.error).toMatch(/Acceso denegado.*no tiene permisos para realizar inspecciones/);
  });

  it("Rejects submission of already COMPLETED task with 409 Conflict to prevent duplicate records", async () => {
    const { POST: submitInspectionRoute } = await import(
      "@/app/api/inspections/submit/route"
    );

    const ronderoSession: SessionPayload = {
      userId: "usr-rnd-01",
      email: "rondas@bosquereal.com",
      name: "Jhonatan Pérez",
      complexId: "comp-bosque-01",
      role: "PARKING_GUARD",
    };

    const token = signSessionToken(ronderoSession);

    mockPrisma.inspectionTask.findUniqueOrThrow.mockResolvedValueOnce({
      id: "task-already-done",
      complexId: "comp-bosque-01",
      vehicleId: "veh-001",
      triggerType: "SCHEDULED",
      status: "COMPLETED", // Already completed!
      dueAt: new Date(),
      completedAt: new Date(),
      createdAt: new Date(),
      updatedAt: new Date(),
      vehicle: { plate: "KHY842" },
    });

    const req = new NextRequest("http://localhost:3000/api/inspections/submit", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        cookie: `parkcheck_session=${token}`,
      },
      body: JSON.stringify({
        taskId: "task-already-done",
        result: "NO_VISIBLE_INCIDENT",
      }),
    });

    const res = await submitInspectionRoute(req);
    expect(res.status).toBe(409);

    const data = await res.json();
    expect(data.alreadyCompleted).toBe(true);
    expect(data.error).toMatch(/ya ha sido completada previamente/);
  });
});

describe("Phase 2 - Workstream D: Vehicle Registration Authorization (POST /api/vehicles/register)", () => {
  it("Denies guards from registering vehicles with 403", async () => {
    const { POST: registerVehicleRoute } = await import(
      "@/app/api/vehicles/register/route"
    );

    const guardSession: SessionPayload = {
      userId: "usr-grd-01",
      email: "porteria@bosquereal.com",
      name: "Carlos Mendoza",
      complexId: "comp-bosque-01",
      role: "ENTRANCE_GUARD",
    };

    const token = signSessionToken(guardSession);
    const req = new NextRequest("http://localhost:3000/api/vehicles/register", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        cookie: `parkcheck_session=${token}`,
      },
      body: JSON.stringify({
        plate: "ABC123",
      }),
    });

    const res = await registerVehicleRoute(req);
    expect(res.status).toBe(403);

    const data = await res.json();
    expect(data.error).toMatch(/Acceso denegado/);
  });

  it("Allows supervisor to register vehicle with normalized plate format (201)", async () => {
    const { POST: registerVehicleRoute } = await import(
      "@/app/api/vehicles/register/route"
    );

    const supervisorSession: SessionPayload = {
      userId: "usr-sup-01",
      email: "supervisor@seguridadcolombia.com",
      name: "Mayor Luis Restrepo",
      complexId: "comp-bosque-01",
      role: "SUPERVISOR",
    };

    mockPrisma.vehicle.findUnique.mockResolvedValueOnce(null); // No collision
    mockPrisma.vehicle.create.mockResolvedValueOnce({
      id: "veh-reg-101",
      complexId: "comp-bosque-01",
      plate: "KHY842",
      parkingSpace: "Torre 1 - 102",
      stickerToken: null,
      createdAt: new Date(),
    });
    mockPrisma.vehiclePresence.create.mockResolvedValueOnce({
      id: "pres-101",
      vehicleId: "veh-reg-101",
      currentStatus: "INSIDE",
    });
    mockPrisma.auditLog.create.mockResolvedValueOnce({});

    const token = signSessionToken(supervisorSession);
    const req = new NextRequest("http://localhost:3000/api/vehicles/register", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        cookie: `parkcheck_session=${token}`,
      },
      body: JSON.stringify({
        plate: "khy-842", // Should be normalized to KHY842
        parkingSpace: "Torre 1 - 102",
        initialPresence: "INSIDE",
      }),
    });

    const res = await registerVehicleRoute(req);
    expect(res.status).toBe(201);

    const data = await res.json();
    expect(data.success).toBe(true);
    expect(data.vehicle.plate).toBe("KHY842");
    expect(data.vehicle.presenceStatus).toBe("INSIDE");
  });
});

describe("Phase 2 - Workstream E: Incident Follow-Up & Management Authorization (POST /api/incidents)", () => {
  it("Rejects guards from updating incidents with 403 Forbidden", async () => {
    const { POST: updateIncidentRoute } = await import(
      "@/app/api/incidents/route"
    );

    const guardSession: SessionPayload = {
      userId: "usr-grd-01",
      email: "porteria@bosquereal.com",
      name: "Carlos Mendoza",
      complexId: "comp-bosque-01",
      role: "ENTRANCE_GUARD", // Lacks canManageIncidents
    };

    const token = signSessionToken(guardSession);
    const req = new NextRequest("http://localhost:3000/api/incidents", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        cookie: `parkcheck_session=${token}`,
      },
      body: JSON.stringify({
        incidentId: "inc-001",
        action: "STATUS_TRANSITION",
        newStatus: "RESOLVED",
      }),
    });

    const res = await updateIncidentRoute(req);
    expect(res.status).toBe(403);

    const data = await res.json();
    expect(data.error).toMatch(/Acceso denegado.*no tiene permisos para gestionar incidentes/);
  });
});

