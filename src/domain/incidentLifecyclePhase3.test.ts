// ParkCheck - Phase 3: Supervisor Controls & Incident Lifecycle Management Tests
// Comprehensive verification of state machine, supervisor actions, RBAC, tenant isolation, CSRF, and concurrency.

import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import {
  createDamageIncident,
  transitionIncidentStatus,
  recordSurveillanceOutcome,
  recordOwnerContact,
  recordInvestigationNote,
  isTransitionAllowed,
  VALID_INCIDENT_TRANSITIONS,
  IncidentEntity,
} from "./incidentService";
import { IncidentStatus, SiteRole } from "./types";
import { signSessionToken, SessionPayload } from "./auth";

// Hoisted mock for prisma
const { mockPrisma } = vi.hoisted(() => {
  const mockPrisma = {
    incident: {
      findMany: vi.fn(),
      findUnique: vi.fn(),
      findUniqueOrThrow: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn().mockImplementation(async () => ({ count: 1 })),
      create: vi.fn(),
    },
    incidentFollowUp: {
      create: vi.fn(),
      findMany: vi.fn(),
    },
    $transaction: vi.fn(async (cb: (tx: any) => Promise<any>) => cb(mockPrisma)),
  };
  return { mockPrisma };
});

vi.mock("@/domain/serverScheduler", () => ({
  prisma: mockPrisma,
}));

import { GET as getIncidentsRoute, POST as postIncidentRoute } from "@/app/api/incidents/route";
import { GET as getSingleIncidentRoute } from "@/app/api/incidents/[id]/route";
import { GET as exportReportsRoute } from "@/app/api/reports/export/route";

const mockComplexId = "complex-phase3-alpha";
const otherComplexId = "complex-foreign-beta";

function createMockIncident(overrides?: Partial<IncidentEntity>): IncidentEntity {
  const now = new Date("2026-10-25T10:00:00Z");
  return {
    id: "inc-test-101",
    complexId: mockComplexId,
    vehicleId: "veh-test-202",
    inspectionRecordId: "rec-test-303",
    reportedById: "guard-user-01",
    observedAt: now,
    description: "Rayón profundo en puerta trasera derecha",
    status: "REPORTED",
    surveillanceRequired: true,
    surveillanceOutcome: null,
    ownerContactRequired: true,
    ownerContactedAt: null,
    ownerContactNotes: null,
    resolutionNotes: null,
    resolvedAt: null,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

function makeSession(role: SiteRole, complexId: string = mockComplexId): SessionPayload {
  return {
    userId: `user-${role.toLowerCase()}`,
    email: `${role.toLowerCase()}@parkcheck.test`,
    name: `User ${role}`,
    complexId,
    role,
  };
}

describe("Phase 3 - Workstream 1: Domain State Machine & Transition Rules", () => {
  it("Initializes newly reported incident with status REPORTED and preserves original observation", () => {
    const now = new Date("2026-10-25T11:00:00Z");
    const incident = createDamageIncident({
      complexId: mockComplexId,
      vehicleId: "veh-456",
      reportedById: "guard-1",
      observedAt: now,
      description: "Paragolpes delantero descolgado",
      surveillanceRequired: true,
      ownerContactRequired: true,
    });

    expect(incident.status).toBe("REPORTED");
    expect(incident.description).toBe("Paragolpes delantero descolgado");
    expect(incident.surveillanceRequired).toBe(true);
    expect(incident.ownerContactRequired).toBe(true);
    expect(incident.resolvedAt).toBeNull();
    expect(incident.resolutionNotes).toBeNull();
  });

  it("Executes the complete canonical incident lifecycle from REPORTED to CLOSED", () => {
    const t0 = new Date("2026-10-25T10:00:00Z");
    let incident = createMockIncident({ observedAt: t0, updatedAt: t0 });

    // Step 1: REPORTED -> AWAITING_REVIEW
    const t1 = new Date("2026-10-25T10:15:00Z");
    const r1 = transitionIncidentStatus(
      incident,
      "AWAITING_REVIEW",
      "Revisado por supervisor de turno; clasificado para investigación",
      "supervisor-1",
      t1
    );
    expect(r1.updatedIncident.status).toBe("AWAITING_REVIEW");
    expect(r1.followUp.actionType).toBe("STATUS_CHANGE");
    incident = r1.updatedIncident;

    // Step 2: AWAITING_REVIEW -> UNDER_INVESTIGATION
    const t2 = new Date("2026-10-25T10:30:00Z");
    const r2 = transitionIncidentStatus(
      incident,
      "UNDER_INVESTIGATION",
      "Iniciando revisión de cámaras y verificación de bitácora de portería",
      "supervisor-1",
      t2
    );
    expect(r2.updatedIncident.status).toBe("UNDER_INVESTIGATION");
    incident = r2.updatedIncident;

    // Step 3: UNDER_INVESTIGATION -> OWNER_CONTACT_PENDING
    const t3 = new Date("2026-10-25T11:00:00Z");
    const r3 = transitionIncidentStatus(
      incident,
      "OWNER_CONTACT_PENDING",
      "Investigación completada: requiere citar al propietario para cotejar daño",
      "supervisor-1",
      t3
    );
    expect(r3.updatedIncident.status).toBe("OWNER_CONTACT_PENDING");
    incident = r3.updatedIncident;

    // Step 4: OWNER_CONTACT_PENDING -> OWNER_CONTACTED
    const t4 = new Date("2026-10-25T11:30:00Z");
    const r4 = recordOwnerContact(
      incident,
      true,
      "Propietario notificado vía citófono. Aceptó firmar acta de inspección.",
      "supervisor-1",
      t4,
      { contactMethod: "INTERCOM", nextAction: "Proceder con cierre administrativo" }
    );
    expect(r4.updatedIncident.status).toBe("OWNER_CONTACTED");
    expect(r4.updatedIncident.ownerContactedAt).toEqual(t4);
    expect(r4.followUp.actionType).toBe("OWNER_CONTACT_ATTEMPT");
    expect(r4.followUp.outcome).toBe("CONTACTED");
    incident = r4.updatedIncident;

    // Step 5: OWNER_CONTACTED -> RESOLVED
    const t5 = new Date("2026-10-25T12:00:00Z");
    const r5 = transitionIncidentStatus(
      incident,
      "RESOLVED",
      "Propietario reconoció daño previo; no se imputa responsabilidad a la copropiedad.",
      "supervisor-1",
      t5
    );
    expect(r5.updatedIncident.status).toBe("RESOLVED");
    expect(r5.updatedIncident.resolvedAt).toEqual(t5);
    expect(r5.updatedIncident.resolutionNotes).toBe(
      "Propietario reconoció daño previo; no se imputa responsabilidad a la copropiedad."
    );
    expect(r5.followUp.actionType).toBe("RESOLUTION");
    incident = r5.updatedIncident;

    // Step 6: RESOLVED -> CLOSED
    const t6 = new Date("2026-10-25T12:30:00Z");
    const r6 = transitionIncidentStatus(
      incident,
      "CLOSED",
      "Expediente archivado en administración sin reclamaciones pendientes.",
      "admin-1",
      t6
    );
    expect(r6.updatedIncident.status).toBe("CLOSED");
    expect(r6.followUp.outcome).toBe("CLOSED");
  });

  it("Supports direct transition from REPORTED to UNDER_INVESTIGATION", () => {
    const incident = createMockIncident();
    const result = transitionIncidentStatus(
      incident,
      "UNDER_INVESTIGATION",
      "Investigación urgente iniciada de inmediato",
      "sup-1",
      new Date()
    );
    expect(result.updatedIncident.status).toBe("UNDER_INVESTIGATION");
  });

  it("Supports direct transition from UNDER_INVESTIGATION to RESOLVED", () => {
    const incident = createMockIncident({ status: "UNDER_INVESTIGATION" });
    const result = transitionIncidentStatus(
      incident,
      "RESOLVED",
      "CCTV confirma que el daño existía antes del ingreso del vehículo",
      "sup-1",
      new Date()
    );
    expect(result.updatedIncident.status).toBe("RESOLVED");
    expect(result.updatedIncident.resolvedAt).toBeDefined();
  });

  it("Rejects premature closure: cannot jump directly from REPORTED to CLOSED", () => {
    const incident = createMockIncident({ status: "REPORTED" });
    expect(() =>
      transitionIncidentStatus(incident, "CLOSED", "Cierre prematuro", "sup-1", new Date())
    ).toThrow(/Transición de estado no permitida/);
  });

  it("Rejects premature closure: cannot jump directly from UNDER_INVESTIGATION to CLOSED", () => {
    const incident = createMockIncident({ status: "UNDER_INVESTIGATION" });
    expect(() =>
      transitionIncidentStatus(incident, "CLOSED", "Cierre sin resolución previa", "sup-1", new Date())
    ).toThrow(/Transición de estado no permitida/);
  });

  it("Rejects premature closure: cannot jump directly from OWNER_CONTACT_PENDING to CLOSED", () => {
    const incident = createMockIncident({ status: "OWNER_CONTACT_PENDING" });
    expect(() =>
      transitionIncidentStatus(incident, "CLOSED", "Cierre sin resolución", "sup-1", new Date())
    ).toThrow(/Transición de estado no permitida/);
  });

  it("Rejects modifications to a CLOSED incident (CLOSED is immutable)", () => {
    const closedIncident = createMockIncident({ status: "CLOSED" });

    expect(() =>
      transitionIncidentStatus(closedIncident, "RESOLVED", "Reabrir", "sup-1", new Date())
    ).toThrow(/un incidente en estado 'CLOSED' no puede ser modificado/);

    expect(() =>
      recordSurveillanceOutcome(closedIncident, "Video revisado", "sup-1", new Date())
    ).toThrow(/un incidente CERRADO/);

    expect(() =>
      recordOwnerContact(closedIncident, true, "Llamada", "sup-1", new Date())
    ).toThrow(/un incidente CERRADO/);

    expect(() =>
      recordInvestigationNote(closedIncident, "Nota posterior", "sup-1", new Date())
    ).toThrow(/un incidente CERRADO/);
  });

  it("Rejects transition to the exact same status", () => {
    const incident = createMockIncident({ status: "UNDER_INVESTIGATION" });
    expect(() =>
      transitionIncidentStatus(incident, "UNDER_INVESTIGATION", "Mismo estado", "sup-1", new Date())
    ).toThrow(/ya se encuentra en estado 'UNDER_INVESTIGATION'/);
  });

  it("Requires non-empty resolution notes when marking RESOLVED", () => {
    const incident = createMockIncident({ status: "OWNER_CONTACTED" });
    expect(() =>
      transitionIncidentStatus(incident, "RESOLVED", "   ", "sup-1", new Date())
    ).toThrow(/Se requieren notas de resolución/);
  });

  it("Requires non-empty closure notes when marking CLOSED", () => {
    const incident = createMockIncident({ status: "RESOLVED" });
    expect(() =>
      transitionIncidentStatus(incident, "CLOSED", "", "sup-1", new Date())
    ).toThrow(/Se requieren notas o justificación de cierre/);
  });

  it("Maintains original incident description and fields intact across transitions", () => {
    const originalDesc = "Rayón profundo en puerta trasera derecha";
    const incident = createMockIncident({ description: originalDesc });

    const step1 = transitionIncidentStatus(
      incident,
      "AWAITING_REVIEW",
      "Notas del supervisor",
      "sup-1",
      new Date()
    );
    expect(step1.updatedIncident.description).toBe(originalDesc);

    const step2 = recordSurveillanceOutcome(
      step1.updatedIncident,
      "CCTV revisado",
      "sup-1",
      new Date()
    );
    expect(step2.updatedIncident.description).toBe(originalDesc);
  });
});

describe("Phase 3 - Workstream 2: Investigation Notes, CCTV & Owner Contact Logic", () => {
  it("Records CCTV surveillance findings without claiming automated video processing", () => {
    const incident = createMockIncident({ status: "UNDER_INVESTIGATION" });
    const now = new Date("2026-10-25T11:45:00Z");

    const result = recordSurveillanceOutcome(
      incident,
      "Cámaras de acceso 2 muestran vehículo ingresando a las 08:30 ya con el rayón",
      "supervisor-cctv",
      now,
      { observations: "Cámara Domo PTZ-03, ángulo noreste" }
    );

    expect(result.updatedIncident.surveillanceOutcome).toContain("ingresando a las 08:30 ya con el rayón");
    expect(result.followUp.actionType).toBe("SURVEILLANCE_REVIEW");
    expect(result.followUp.performedById).toBe("supervisor-cctv");
    expect(result.followUp.description).toContain("Cámara Domo PTZ-03");
  });

  it("Rejects CCTV review with empty outcome text", () => {
    const incident = createMockIncident();
    expect(() =>
      recordSurveillanceOutcome(incident, "   ", "sup-1", new Date())
    ).toThrow(/resultado de la revisión de cámaras de seguridad es requerido/);
  });

  it("Records failed owner contact attempt and transitions status to OWNER_CONTACT_PENDING", () => {
    const incident = createMockIncident({ status: "UNDER_INVESTIGATION" });
    const now = new Date("2026-10-25T14:00:00Z");

    const result = recordOwnerContact(
      incident,
      false,
      "Citófono no responde en torre 4 apto 502",
      "guard-gate",
      now,
      { contactMethod: "INTERCOM", nextAction: "Reintentar llamada telefónica a las 18:00" }
    );

    expect(result.updatedIncident.status).toBe("OWNER_CONTACT_PENDING");
    expect(result.updatedIncident.ownerContactNotes).toBe("Citófono no responde en torre 4 apto 502");
    expect(result.followUp.actionType).toBe("OWNER_CONTACT_ATTEMPT");
    expect(result.followUp.outcome).toBe("RETRY_NEEDED");
    expect(result.followUp.description).toContain("Pendiente");
    expect(result.followUp.description).toContain("Próxima acción: Reintentar llamada telefónica");
  });

  it("Records successful owner contact and transitions status to OWNER_CONTACTED", () => {
    const incident = createMockIncident({ status: "OWNER_CONTACT_PENDING" });
    const now = new Date("2026-10-25T18:05:00Z");

    const result = recordOwnerContact(
      incident,
      true,
      "Propietario contestó llamada celular y confirmó que reparará el daño externamente",
      "supervisor-1",
      now,
      { contactMethod: "PHONE", nextAction: "Cierre tras firma de desistimiento" }
    );

    expect(result.updatedIncident.status).toBe("OWNER_CONTACTED");
    expect(result.updatedIncident.ownerContactedAt).toEqual(now);
    expect(result.followUp.outcome).toBe("CONTACTED");
    expect(result.followUp.description).toContain("Exitoso vía PHONE");
  });

  it("Rejects owner contact on an already RESOLVED incident", () => {
    const resolvedIncident = createMockIncident({ status: "RESOLVED" });
    expect(() =>
      recordOwnerContact(resolvedIncident, true, "Llamada extemporánea", "sup-1", new Date())
    ).toThrow(/no se pueden registrar contactos con el propietario en un incidente ya RESUELTO/i);
  });

  it("Appends an investigation note with directive without mutating incident status", () => {
    const incident = createMockIncident({ status: "UNDER_INVESTIGATION" });
    const now = new Date();

    const result = recordInvestigationNote(
      incident,
      "Se entrevistó al rondero del turno diurno; no hubo maniobras sospechosas registradas",
      "sup-1",
      now,
      { nextAction: "Revisar grabaciones del pasillo 3" }
    );

    expect(result.updatedIncident.status).toBe("UNDER_INVESTIGATION");
    expect(result.followUp.actionType).toBe("NOTE");
    expect(result.followUp.description).toContain("Se entrevistó al rondero");
    expect(result.followUp.description).toContain("Revisar grabaciones del pasillo 3");
  });
});

describe("Phase 3 - Workstream 3: API Route Authorization, Security & Tenant Isolation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockPrisma.incident.updateMany.mockImplementation(async () => ({ count: 1 }));
  });

  it("Rejects unauthenticated requests with 401", async () => {
    const req = new NextRequest("http://localhost:3000/api/incidents", {
      method: "POST",
      body: JSON.stringify({ incidentId: "inc-1", action: "STATUS_TRANSITION" }),
      headers: { "Content-Type": "application/json" },
    });

    const res = await postIncidentRoute(req);
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error).toContain("No autenticado");
  });

  it("Enforces RBAC: guards (ENTRANCE_GUARD, PARKING_GUARD) are rejected with 403", async () => {
    for (const guardRole of ["ENTRANCE_GUARD", "PARKING_GUARD"] as SiteRole[]) {
      const session = makeSession(guardRole);
      const token = signSessionToken(session);

      const req = new NextRequest("http://localhost:3000/api/incidents", {
        method: "POST",
        body: JSON.stringify({
          incidentId: "inc-1",
          action: "STATUS_TRANSITION",
          newStatus: "UNDER_INVESTIGATION",
          notes: "Guard trying to advance status",
        }),
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
      });

      const res = await postIncidentRoute(req);
      expect(res.status).toBe(403);
      const body = await res.json();
      expect(body.error).toContain("no tiene permisos para gestionar incidentes");
    }
  });

  it("Enforces RBAC: SUPERVISOR, RESIDENTIAL_ADMIN, and PLATFORM_ADMIN are permitted", async () => {
    for (const authorizedRole of ["SUPERVISOR", "RESIDENTIAL_ADMIN", "PLATFORM_ADMIN"] as SiteRole[]) {
      const session = makeSession(authorizedRole);
      const token = signSessionToken(session);

      const incidentInDb = createMockIncident({ status: "REPORTED" });
      mockPrisma.incident.findUnique.mockResolvedValueOnce(incidentInDb);
      mockPrisma.incident.update.mockResolvedValueOnce({
        ...incidentInDb,
        status: "UNDER_INVESTIGATION",
      });
      mockPrisma.incidentFollowUp.create.mockResolvedValueOnce({ id: "fup-mock-1" });

      const req = new NextRequest("http://localhost:3000/api/incidents", {
        method: "POST",
        body: JSON.stringify({
          incidentId: incidentInDb.id,
          action: "STATUS_TRANSITION",
          newStatus: "UNDER_INVESTIGATION",
          notes: "Supervisory investigation started",
        }),
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
      });

      const res = await postIncidentRoute(req);
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.success).toBe(true);
      expect(body.incident.status).toBe("UNDER_INVESTIGATION");
    }
  });

  it("Enforces tenant isolation: rejecting cross-complex incident mutation with 403", async () => {
    const session = makeSession("SUPERVISOR", mockComplexId);
    const token = signSessionToken(session);

    // Incident belongs to otherComplexId
    const foreignIncident = createMockIncident({
      id: "inc-foreign-999",
      complexId: otherComplexId,
    });
    mockPrisma.incident.findUnique.mockResolvedValueOnce(foreignIncident);

    const req = new NextRequest("http://localhost:3000/api/incidents", {
      method: "POST",
      body: JSON.stringify({
        incidentId: foreignIncident.id,
        action: "STATUS_TRANSITION",
        newStatus: "AWAITING_REVIEW",
        notes: "Attempted cross-tenant tamper",
      }),
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
    });

    const res = await postIncidentRoute(req);
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error).toContain("no pertenece a su conjunto residencial");
  });

  it("Enforces CSRF origin check on cookie-authenticated requests", async () => {
    const session = makeSession("SUPERVISOR");
    const token = signSessionToken(session);

    // Cookie session with forged Origin
    const req = new NextRequest("http://localhost:3000/api/incidents", {
      method: "POST",
      body: JSON.stringify({
        incidentId: "inc-1",
        action: "STATUS_TRANSITION",
      }),
      headers: {
        "Content-Type": "application/json",
        Cookie: `parkcheck_session=${token}`,
        Host: "parkcheck.local",
        Origin: "http://attacker-evil-site.com",
      },
    });

    const res = await postIncidentRoute(req);
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error).toContain("CSRF");
  });

  it("Rejects missing and malformed request bodies with 400", async () => {
    const session = makeSession("SUPERVISOR");
    const token = signSessionToken(session);

    // Missing action
    const req1 = new NextRequest("http://localhost:3000/api/incidents", {
      method: "POST",
      body: JSON.stringify({ incidentId: "inc-1" }),
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
    });
    const res1 = await postIncidentRoute(req1);
    expect(res1.status).toBe(400);

    // Invalid action type
    const req2 = new NextRequest("http://localhost:3000/api/incidents", {
      method: "POST",
      body: JSON.stringify({ incidentId: "inc-1", action: "INVALID_ACTION_HACK" }),
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
    });
    const res2 = await postIncidentRoute(req2);
    expect(res2.status).toBe(400);
    const body2 = await res2.json();
    expect(body2.error).toContain("Acción no soportada");
  });

  it("Rejects invalid state transitions at API layer without updating DB", async () => {
    const session = makeSession("SUPERVISOR");
    const token = signSessionToken(session);

    const incidentInDb = createMockIncident({ status: "REPORTED" });
    mockPrisma.incident.findUnique.mockResolvedValueOnce(incidentInDb);

    // Invalid transition: REPORTED directly to CLOSED
    const req = new NextRequest("http://localhost:3000/api/incidents", {
      method: "POST",
      body: JSON.stringify({
        incidentId: incidentInDb.id,
        action: "STATUS_TRANSITION",
        newStatus: "CLOSED",
        notes: "Trying to close directly",
      }),
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
    });

    const res = await postIncidentRoute(req);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toContain("Transición de estado no permitida");
    // Ensure update was NEVER called
    expect(mockPrisma.incident.update).not.toHaveBeenCalled();
    expect(mockPrisma.incidentFollowUp.create).not.toHaveBeenCalled();
  });

  it("Enforces optimistic concurrency control: rejects concurrent update with 409", async () => {
    const session = makeSession("SUPERVISOR");
    const token = signSessionToken(session);

    const oldTimestamp = new Date("2026-10-25T10:00:00Z");
    const newerServerTimestamp = new Date("2026-10-25T10:05:00Z");

    const incidentInDb = createMockIncident({
      status: "REPORTED",
      updatedAt: newerServerTimestamp,
    });
    mockPrisma.incident.findUnique.mockResolvedValueOnce(incidentInDb);

    // Client sends stale expectedUpdatedAt from before newerServerTimestamp
    const req = new NextRequest("http://localhost:3000/api/incidents", {
      method: "POST",
      body: JSON.stringify({
        incidentId: incidentInDb.id,
        action: "STATUS_TRANSITION",
        newStatus: "UNDER_INVESTIGATION",
        notes: "Concurrent attempt",
        expectedUpdatedAt: oldTimestamp.toISOString(),
      }),
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
    });

    const res = await postIncidentRoute(req);
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.code).toBe("CONCURRENT_MODIFICATION");
    expect(mockPrisma.incident.update).not.toHaveBeenCalled();
  });

  it("Filters incidents by status and tenant on GET /api/incidents", async () => {
    const session = makeSession("SUPERVISOR", mockComplexId);
    const token = signSessionToken(session);

    mockPrisma.incident.findMany.mockResolvedValueOnce([
      createMockIncident({ status: "UNDER_INVESTIGATION" }),
    ]);

    const req = new NextRequest(
      "http://localhost:3000/api/incidents?status=UNDER_INVESTIGATION",
      {
        headers: { Authorization: `Bearer ${token}` },
      }
    );

    const res = await getIncidentsRoute(req);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.incidents.length).toBe(1);

    expect(mockPrisma.incident.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          complexId: mockComplexId,
          status: "UNDER_INVESTIGATION",
        }),
      })
    );
  });

  it("Fetches single incident details through dedicated route GET /api/incidents/[id]", async () => {
    const session = makeSession("SUPERVISOR", mockComplexId);
    const token = signSessionToken(session);

    const inc = createMockIncident({ id: "inc-target-99" });
    mockPrisma.incident.findUnique.mockResolvedValueOnce(inc);

    const req = new NextRequest("http://localhost:3000/api/incidents/inc-target-99", {
      headers: { Authorization: `Bearer ${token}` },
    });

    const res = await getSingleIncidentRoute(req, {
      params: Promise.resolve({ id: "inc-target-99" }),
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.incident.id).toBe("inc-target-99");
  });
});

describe("Phase 3 - Remediation Fix 1: Lifecycle Transitions & Invariant Enforcement", () => {
  it("Rejects owner contact from REPORTED when contact is successful", () => {
    const incident = createMockIncident({ status: "REPORTED" });
    expect(() =>
      recordOwnerContact(incident, true, "Llamada al propietario", "sup-1", new Date())
    ).toThrow(/Transición de estado no permitida para contacto con propietario: de 'REPORTED' a 'OWNER_CONTACTED'/);
  });

  it("Rejects owner contact from REPORTED when contact is unsuccessful", () => {
    const incident = createMockIncident({ status: "REPORTED" });
    expect(() =>
      recordOwnerContact(incident, false, "Sin respuesta", "sup-1", new Date())
    ).toThrow(/Transición de estado no permitida para contacto con propietario: de 'REPORTED' a 'OWNER_CONTACT_PENDING'/);
  });

  it("Allows permitted owner-contact transitions: UNDER_INVESTIGATION to OWNER_CONTACTED or OWNER_CONTACT_PENDING", () => {
    const now = new Date();
    const incident = createMockIncident({ status: "UNDER_INVESTIGATION" });

    // Successful contact advances to OWNER_CONTACTED
    const successResult = recordOwnerContact(incident, true, "Contactado por citófono", "sup-1", now);
    expect(successResult.updatedIncident.status).toBe("OWNER_CONTACTED");
    expect(successResult.updatedIncident.ownerContactedAt).toEqual(now);

    // Unsuccessful contact transitions to OWNER_CONTACT_PENDING
    const pendingResult = recordOwnerContact(incident, false, "No contestó citófono", "sup-1", now);
    expect(pendingResult.updatedIncident.status).toBe("OWNER_CONTACT_PENDING");
  });

  it("Allows permitted owner-contact transitions: OWNER_CONTACT_PENDING to OWNER_CONTACTED and retry logging", () => {
    const now = new Date();
    const pendingIncident = createMockIncident({ status: "OWNER_CONTACT_PENDING" });

    // Successful contact transitions to OWNER_CONTACTED
    const successResult = recordOwnerContact(pendingIncident, true, "Propietario atendió", "sup-1", now);
    expect(successResult.updatedIncident.status).toBe("OWNER_CONTACTED");

    // Re-attempt while pending remains in OWNER_CONTACT_PENDING and appends follow-up
    const retryResult = recordOwnerContact(pendingIncident, false, "Segundo intento fallido", "sup-1", now);
    expect(retryResult.updatedIncident.status).toBe("OWNER_CONTACT_PENDING");
    expect(retryResult.followUp.actionType).toBe("OWNER_CONTACT_ATTEMPT");
    expect(retryResult.followUp.outcome).toBe("RETRY_NEEDED");
  });

  it("Enforces that CLOSED remains terminal across all mutation methods", () => {
    const closed = createMockIncident({ status: "CLOSED" });
    const now = new Date();

    expect(() =>
      transitionIncidentStatus(closed, "RESOLVED", "Reabrir", "sup-1", now)
    ).toThrow(/un incidente en estado 'CLOSED' no puede ser modificado/);

    expect(() =>
      recordSurveillanceOutcome(closed, "Video revisado", "sup-1", now)
    ).toThrow(/un incidente CERRADO/);

    expect(() =>
      recordOwnerContact(closed, true, "Llamada", "sup-1", now)
    ).toThrow(/un incidente CERRADO/);

    expect(() =>
      recordInvestigationNote(closed, "Nota tardía", "sup-1", now)
    ).toThrow(/un incidente CERRADO/);
  });

  it("Enforces that resolution notes are mandatory when transitioning to RESOLVED", () => {
    const incident = createMockIncident({ status: "UNDER_INVESTIGATION" });
    expect(() =>
      transitionIncidentStatus(incident, "RESOLVED", "", "sup-1", new Date())
    ).toThrow(/Se requieren notas de resolución para marcar el incidente como RESUELTO/);

    expect(() =>
      transitionIncidentStatus(incident, "RESOLVED", "   ", "sup-1", new Date())
    ).toThrow(/Se requieren notas de resolución para marcar el incidente como RESUELTO/);
  });

  it("Enforces that closure justification notes are mandatory when transitioning to CLOSED", () => {
    const incident = createMockIncident({ status: "RESOLVED" });
    expect(() =>
      transitionIncidentStatus(incident, "CLOSED", "", "sup-1", new Date())
    ).toThrow(/Se requieren notas o justificación de cierre para archivar el incidente como CERRADO/);

    expect(() =>
      transitionIncidentStatus(incident, "CLOSED", "   ", "sup-1", new Date())
    ).toThrow(/Se requieren notas o justificación de cierre para archivar el incidente como CERRADO/);
  });
});

describe("Phase 3 - Remediation Fix 2: Optimistic Concurrency Control (Unit-Level Tests)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockPrisma.incident.updateMany.mockImplementation(async () => ({ count: 1 }));
  });

  it("[Unit] Handles missing concurrency tokens gracefully without breaking mobile/headless callers", async () => {
    const session = makeSession("SUPERVISOR");
    const token = signSessionToken(session);
    const incidentInDb = createMockIncident({ status: "REPORTED" });
    mockPrisma.incident.findUnique.mockResolvedValue(incidentInDb);

    const req = new NextRequest("http://localhost:3000/api/incidents", {
      method: "POST",
      body: JSON.stringify({
        incidentId: incidentInDb.id,
        action: "STATUS_TRANSITION",
        newStatus: "AWAITING_REVIEW",
        notes: "Mutation without expectedUpdatedAt token",
      }),
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
    });

    const res = await postIncidentRoute(req);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(mockPrisma.incident.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          id: incidentInDb.id,
          updatedAt: incidentInDb.updatedAt,
        }),
      })
    );
  });

  it("[Unit] Rejects invalid/malformed expectedUpdatedAt date format with 400", async () => {
    const session = makeSession("SUPERVISOR");
    const token = signSessionToken(session);
    const incidentInDb = createMockIncident({ status: "REPORTED" });
    mockPrisma.incident.findUnique.mockResolvedValueOnce(incidentInDb);

    const req = new NextRequest("http://localhost:3000/api/incidents", {
      method: "POST",
      body: JSON.stringify({
        incidentId: incidentInDb.id,
        action: "STATUS_TRANSITION",
        newStatus: "AWAITING_REVIEW",
        notes: "Malformed token",
        expectedUpdatedAt: "not-a-valid-date",
      }),
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
    });

    const res = await postIncidentRoute(req);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.code).toBe("INVALID_CONCURRENCY_TOKEN");
  });

  it("[Unit] Strictly rejects sub-second timestamp mismatches (eliminates 1000ms window)", async () => {
    const session = makeSession("SUPERVISOR");
    const token = signSessionToken(session);

    const serverTimestamp = new Date("2026-10-25T12:00:00.500Z");
    const staleClientTimestamp = new Date("2026-10-25T12:00:00.100Z"); // 400ms difference (previously ignored by 1s window)

    const incidentInDb = createMockIncident({
      status: "UNDER_INVESTIGATION",
      updatedAt: serverTimestamp,
    });
    mockPrisma.incident.findUnique.mockResolvedValueOnce(incidentInDb);

    const req = new NextRequest("http://localhost:3000/api/incidents", {
      method: "POST",
      body: JSON.stringify({
        incidentId: incidentInDb.id,
        action: "STATUS_TRANSITION",
        newStatus: "OWNER_CONTACT_PENDING",
        notes: "Sub-second race check",
        expectedUpdatedAt: staleClientTimestamp.toISOString(),
      }),
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
    });

    const res = await postIncidentRoute(req);
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.code).toBe("CONCURRENT_MODIFICATION");
    expect(mockPrisma.incident.updateMany).not.toHaveBeenCalled();
    expect(mockPrisma.incidentFollowUp.create).not.toHaveBeenCalled();
  });

  it("[Unit] Rejects concurrent conflicting write when atomic conditional update matches 0 rows", async () => {
    const session = makeSession("SUPERVISOR");
    const token = signSessionToken(session);
    const serverTimestamp = new Date("2026-10-25T12:00:00.000Z");

    const incidentInDb = createMockIncident({
      status: "UNDER_INVESTIGATION",
      updatedAt: serverTimestamp,
    });
    mockPrisma.incident.findUnique.mockResolvedValueOnce(incidentInDb);

    // Simulate database race: another transaction updated the row between read and write
    mockPrisma.incident.updateMany.mockResolvedValueOnce({ count: 0 });

    const req = new NextRequest("http://localhost:3000/api/incidents", {
      method: "POST",
      body: JSON.stringify({
        incidentId: incidentInDb.id,
        action: "STATUS_TRANSITION",
        newStatus: "OWNER_CONTACT_PENDING",
        notes: "Concurrent race simulation",
        expectedUpdatedAt: serverTimestamp.toISOString(),
      }),
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
    });

    const res = await postIncidentRoute(req);
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.code).toBe("CONCURRENT_MODIFICATION");
    // Crucial: Follow-up audit entry must NOT be created on conflict
    expect(mockPrisma.incidentFollowUp.create).not.toHaveBeenCalled();
  });
});

describe("Phase 3 - Remediation Fix 3: Incident CSV Export (API & Unit-Level Tests)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("Rejects unauthenticated export requests with 401", async () => {
    const req = new NextRequest("http://localhost:3000/api/reports/export?type=incidents");
    const res = await exportReportsRoute(req);
    expect(res.status).toBe(401);
  });

  it("Rejects unauthorized guard roles (ENTRANCE_GUARD) with 403", async () => {
    const session = makeSession("ENTRANCE_GUARD");
    const token = signSessionToken(session);
    const req = new NextRequest("http://localhost:3000/api/reports/export?type=incidents", {
      headers: { Authorization: `Bearer ${token}` },
    });

    const res = await exportReportsRoute(req);
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error).toContain("Permisos insuficientes");
  });

  it("Enforces tenant isolation by scoping incident export strictly to session complexId", async () => {
    const session = makeSession("SUPERVISOR", mockComplexId);
    const token = signSessionToken(session);

    mockPrisma.incident.findMany.mockResolvedValueOnce([]);

    const req = new NextRequest("http://localhost:3000/api/reports/export?type=incidents", {
      headers: { Authorization: `Bearer ${token}` },
    });

    const res = await exportReportsRoute(req);
    expect(res.status).toBe(200);

    expect(mockPrisma.incident.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          complexId: mockComplexId,
        }),
      })
    );
  });

  it("Generates valid RFC-compliant CSV with proper headers, content-type, filename, and escaping", async () => {
    const session = makeSession("SUPERVISOR", mockComplexId);
    const token = signSessionToken(session);

    const mockRecords = [
      {
        id: "inc-csv-1",
        complexId: mockComplexId,
        vehicleId: "veh-1",
        vehicle: { plate: "ABC123", parkingSpace: "P-101" },
        reportedBy: { name: "Guardia Carlos" },
        observedAt: new Date("2026-10-25T08:30:00Z"),
        description: 'Rayón con "objeto punzante", puerta lateral\nLínea 2 de observación',
        status: "RESOLVED",
        surveillanceRequired: true,
        surveillanceOutcome: "CCTV revisado",
        ownerContactRequired: true,
        ownerContactedAt: new Date("2026-10-25T09:00:00Z"),
        resolutionNotes: 'Conformidad con propietario, "sin costos"',
        resolvedAt: new Date("2026-10-25T10:00:00Z"),
      },
    ];

    mockPrisma.incident.findMany.mockResolvedValueOnce(mockRecords);

    const req = new NextRequest("http://localhost:3000/api/reports/export?type=incidents", {
      headers: { Authorization: `Bearer ${token}` },
    });

    const res = await exportReportsRoute(req);
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("text/csv; charset=utf-8");
    expect(res.headers.get("Content-Disposition")).toContain(`incidentes_${mockComplexId}_`);
    expect(res.headers.get("Content-Disposition")).toContain(".csv");

    const csvText = await res.text();
    const lines = csvText.split("\n");

    // Header check
    expect(lines[0]).toBe(
      "ID_Incidente,Fecha_Observacion,Placa,Parqueadero,Estado,Reportado_Por,Requiere_CCTV,Resultado_CCTV,Requiere_Contacto,Fecha_Contacto,Descripcion,Notas_Resolucion,Fecha_Resolucion"
    );

    // Escaping check: quotes doubled, multi-line retained inside quotes
    expect(csvText).toContain('"inc-csv-1"');
    expect(csvText).toContain('"ABC123"');
    expect(csvText).toContain('"Guardia Carlos"');
    expect(csvText).toContain('""objeto punzante""');
    expect(csvText).toContain('""sin costos""');
  });

  it("Rejects unsupported report types with 400", async () => {
    const session = makeSession("SUPERVISOR");
    const token = signSessionToken(session);

    const req = new NextRequest("http://localhost:3000/api/reports/export?type=unknown_audit_dump", {
      headers: { Authorization: `Bearer ${token}` },
    });

    const res = await exportReportsRoute(req);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toContain("Tipo de reporte no válido");
  });
});

describe("Phase 3 - Remediation Fix 4: Resolution Action Eligibility & State Matrix", () => {
  it("Proves REPORTED cannot transition to RESOLVED directly", () => {
    expect(isTransitionAllowed("REPORTED", "RESOLVED")).toBe(false);
    expect(VALID_INCIDENT_TRANSITIONS.REPORTED).not.toContain("RESOLVED");

    const incident = createMockIncident({ status: "REPORTED" });
    expect(() =>
      transitionIncidentStatus(incident, "RESOLVED", "Intento de resolución directa", "sup-1", new Date())
    ).toThrow(/Transición de estado no permitida: de 'REPORTED' a 'RESOLVED'/);
  });

  it("Proves RESOLVED is only accessible from permitted investigation/contact states", () => {
    const permittedSourceStates: IncidentStatus[] = [
      "AWAITING_REVIEW",
      "UNDER_INVESTIGATION",
      "OWNER_CONTACT_PENDING",
      "OWNER_CONTACTED",
    ];

    for (const source of permittedSourceStates) {
      expect(isTransitionAllowed(source, "RESOLVED")).toBe(true);
      expect(VALID_INCIDENT_TRANSITIONS[source]).toContain("RESOLVED");

      const incident = createMockIncident({ status: source });
      const res = transitionIncidentStatus(incident, "RESOLVED", "Dictamen formal de cierre", "sup-1", new Date());
      expect(res.updatedIncident.status).toBe("RESOLVED");
    }
  });

  it("Proves CLOSED is terminal and does not permit resolution or any subsequent transition", () => {
    expect(isTransitionAllowed("CLOSED", "RESOLVED")).toBe(false);
    expect(VALID_INCIDENT_TRANSITIONS.CLOSED).toEqual([]);

    const closed = createMockIncident({ status: "CLOSED" });
    expect(() =>
      transitionIncidentStatus(closed, "RESOLVED", "Intento en cerrado", "sup-1", new Date())
    ).toThrow(/un incidente en estado 'CLOSED' no puede ser modificado/);
  });
});
