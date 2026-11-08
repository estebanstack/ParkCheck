// ParkCheck - Real PostgreSQL & Prisma Integration Tests
// Specification Reference: Phase C, Section 4

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { PrismaClient } from "@prisma/client";

describe("PostgreSQL Real Database Integration & Schema Constraints", () => {
  let prisma: PrismaClient;
  let isPostgresAvailable = false;

  beforeAll(async () => {
    prisma = new PrismaClient({
      datasources: {
        db: {
          url: process.env.DATABASE_URL || "postgresql://postgres:postgres@localhost:5432/parkcheck?schema=public",
        },
      },
    });

    try {
      // 1-second timeout ping to verify live database connectivity
      await prisma.$queryRaw`SELECT 1`;
      isPostgresAvailable = true;
    } catch {
      isPostgresAvailable = false;
      console.log(
        "ℹ️ [PostgreSQL Integration Tests] Live PostgreSQL daemon is not active on DATABASE_URL. Real DB tests will be conditionally skipped. Transactional mock tests verify domain logic."
      );
    }
  });

  afterAll(async () => {
    if (prisma) {
      await prisma.$disconnect();
    }
  });

  it("Verifies database-enforced idempotency via @@unique([complexId, clientEventId]) constraint", async (ctx) => {
    if (!isPostgresAvailable) {
      ctx.skip();
      return;
    }

    const testComplexId = `comp-pg-${Date.now()}`;
    const clientEventId = `evt-pg-unique-${Date.now()}`;

    // 1. Create temporary complex
    const complex = await prisma.residentialComplex.create({
      data: {
        id: testComplexId,
        code: `PG-TEST-${Date.now()}`,
        name: "Test Complex PostgreSQL",
      },
    });

    try {
      // 2. Insert first sync log
      await prisma.syncEventLog.create({
        data: {
          complexId: complex.id,
          clientEventId,
          eventType: "MOVEMENT",
          status: "ACKNOWLEDGED",
          recordedAt: new Date(),
        },
      });

      // 3. Attempt duplicate insert with identical [complexId, clientEventId]
      // Database MUST reject with unique constraint code P2002
      let caughtError: { code?: string } | null = null;
      try {
        await prisma.syncEventLog.create({
          data: {
            complexId: complex.id,
            clientEventId,
            eventType: "MOVEMENT",
            status: "ACKNOWLEDGED",
            recordedAt: new Date(),
          },
        });
      } catch (err: unknown) {
        caughtError = err as { code?: string };
      }

      expect(caughtError).not.toBeNull();
      expect(caughtError?.code).toBe("P2002"); // Prisma Unique Constraint Violation
    } finally {
      // Cleanup
      await prisma.residentialComplex.delete({ where: { id: complex.id } });
    }
  });

  it("Enforces plate uniqueness per complex via @@unique([complexId, plate]) constraint", async (ctx) => {
    if (!isPostgresAvailable) {
      ctx.skip();
      return;
    }

    const testComplexId = `comp-pg-plate-${Date.now()}`;
    const plate = "KHY842";

    const complex = await prisma.residentialComplex.create({
      data: {
        id: testComplexId,
        code: `PG-TEST-PLT-${Date.now()}`,
        name: "Test Complex Plates",
      },
    });

    try {
      await prisma.vehicle.create({
        data: {
          complexId: complex.id,
          plate,
        },
      });

      let duplicateError: { code?: string } | null = null;
      try {
        await prisma.vehicle.create({
          data: {
            complexId: complex.id,
            plate,
          },
        });
      } catch (err: unknown) {
        duplicateError = err as { code?: string };
      }

      expect(duplicateError).not.toBeNull();
      expect(duplicateError?.code).toBe("P2002");
    } finally {
      await prisma.residentialComplex.delete({ where: { id: complex.id } });
    }
  });

  it("Verifies atomic transaction rollback when an error occurs during multi-step sync", async (ctx) => {
    if (!isPostgresAvailable) {
      ctx.skip();
      return;
    }

    const testComplexId = `comp-pg-rollback-${Date.now()}`;
    const complex = await prisma.residentialComplex.create({
      data: {
        id: testComplexId,
        code: `PG-TEST-RB-${Date.now()}`,
        name: "Test Complex Rollback",
      },
    });

    try {
      // Execute a transaction that creates a vehicle and then intentionally throws
      let rolledBack = false;
      try {
        await prisma.$transaction(async (tx) => {
          await tx.vehicle.create({
            data: {
              complexId: complex.id,
              plate: "RBK001",
            },
          });

          // Simulate unhandled failure in step 2
          throw new Error("Intentional step failure to trigger rollback");
        });
      } catch {
        rolledBack = true;
      }

      expect(rolledBack).toBe(true);

      // Verify vehicle was NOT saved to the database
      const found = await prisma.vehicle.findUnique({
        where: {
          complexId_plate: {
            complexId: complex.id,
            plate: "RBK001",
          },
        },
      });
      expect(found).toBeNull();
    } finally {
      await prisma.residentialComplex.delete({ where: { id: complex.id } });
    }
  });

  it("Guarantees cross-complex isolation: vehicles in Complex A are invisible to Complex B queries", async (ctx) => {
    if (!isPostgresAvailable) {
      ctx.skip();
      return;
    }

    const complexA = await prisma.residentialComplex.create({
      data: { id: `comp-a-${Date.now()}`, code: `CODE-A-${Date.now()}`, name: "Complex A" },
    });
    const complexB = await prisma.residentialComplex.create({
      data: { id: `comp-b-${Date.now()}`, code: `CODE-B-${Date.now()}`, name: "Complex B" },
    });

    try {
      await prisma.vehicle.create({
        data: { complexId: complexA.id, plate: "ISO100" },
      });

      // Complex B query must return empty
      const foundInB = await prisma.vehicle.findUnique({
        where: {
          complexId_plate: {
            complexId: complexB.id,
            plate: "ISO100",
          },
        },
      });
      expect(foundInB).toBeNull();
    } finally {
      await prisma.residentialComplex.delete({ where: { id: complexA.id } });
      await prisma.residentialComplex.delete({ where: { id: complexB.id } });
    }
  });

  it("Verifies actual persistence and relational linkage of movements, inspection obligations, incidents, and audit records", async (ctx) => {
    if (!isPostgresAvailable) {
      ctx.skip();
      return;
    }

    const testComplexId = `comp-pg-lifecycle-${Date.now()}`;
    const complex = await prisma.residentialComplex.create({
      data: {
        id: testComplexId,
        code: `PG-LIFE-${Date.now()}`,
        name: "Test Complex Lifecycle",
      },
    });

    try {
      // 1. Create a guard user
      const user = await prisma.user.create({
        data: {
          email: `guard-${Date.now()}@parkcheck.test`,
          name: "Guard Test",
          passwordHash: "hash-placeholder",
          siteRoles: {
            create: {
              complexId: complex.id,
              role: "ENTRANCE_GUARD",
            },
          },
        },
      });

      // 2. Register vehicle
      const vehicle = await prisma.vehicle.create({
        data: {
          complexId: complex.id,
          plate: "LIF999",
          parkingSpace: "T1-101",
        },
      });

      // 3. Persist vehicle movement event (ARRIVAL)
      const movement = await prisma.vehicleMovementEvent.create({
        data: {
          complexId: complex.id,
          vehicleId: vehicle.id,
          eventType: "ARRIVAL",
          source: "GATE_MANUAL",
          recordedById: user.id,
        },
      });
      expect(movement.id).toBeDefined();

      // 4. Persist inspection task obligation triggered by movement
      const dueAt = new Date(Date.now() + 15 * 60 * 1000);
      const inspectionTask = await prisma.inspectionTask.create({
        data: {
          complexId: complex.id,
          vehicleId: vehicle.id,
          triggerType: "RETURN",
          status: "PENDING",
          dueAt,
          relatedMovementId: movement.id,
        },
      });
      expect(inspectionTask.id).toBeDefined();
      expect(inspectionTask.relatedMovementId).toBe(movement.id);

      // 5. Persist an incident
      const incident = await prisma.incident.create({
        data: {
          complexId: complex.id,
          vehicleId: vehicle.id,
          reportedById: user.id,
          description: "Scratched bumper observed during gate arrival",
          status: "REPORTED",
          surveillanceRequired: true,
        },
      });
      expect(incident.id).toBeDefined();

      // 6. Persist audit log
      const auditLog = await prisma.auditLog.create({
        data: {
          complexId: complex.id,
          userId: user.id,
          action: "INCIDENT_REPORTED",
          entityType: "INCIDENT",
          entityId: incident.id,
          detailsJson: JSON.stringify({ description: incident.description }),
        },
      });
      expect(auditLog.id).toBeDefined();

      // 7. Verify all records can be queried back with relational links intact
      const queriedMovement = await prisma.vehicleMovementEvent.findUnique({
        where: { id: movement.id },
        include: { triggeredTasks: true, vehicle: true },
      });
      expect(queriedMovement).not.toBeNull();
      expect(queriedMovement?.vehicle.plate).toBe("LIF999");
      expect(queriedMovement?.triggeredTasks).toHaveLength(1);
      expect(queriedMovement?.triggeredTasks[0].id).toBe(inspectionTask.id);

      const queriedIncident = await prisma.incident.findUnique({
        where: { id: incident.id },
        include: { reportedBy: true },
      });
      expect(queriedIncident).not.toBeNull();
      expect(queriedIncident?.reportedBy.id).toBe(user.id);
    } finally {
      // Cascading delete cleans up all dependent records safely
      await prisma.residentialComplex.delete({ where: { id: complex.id } });
    }
  });

  it("Verifies atomic conditional update and optimistic concurrency on Incident row in PostgreSQL", async (ctx) => {
    if (!isPostgresAvailable) {
      ctx.skip();
      return;
    }

    const testComplexId = `comp-pg-occ-${Date.now()}`;
    const complex = await prisma.residentialComplex.create({
      data: {
        id: testComplexId,
        code: `PG-TEST-OCC-${Date.now()}`,
        name: "Test Complex OCC",
      },
    });

    try {
      const user = await prisma.user.create({
        data: {
          email: `occ-user-${Date.now()}@parkcheck.test`,
          name: "OCC Supervisor",
          passwordHash: "hash123",
        },
      });

      const vehicle = await prisma.vehicle.create({
        data: {
          complexId: complex.id,
          plate: `OCC${Math.floor(100 + Math.random() * 900)}`,
        },
      });

      const incident = await prisma.incident.create({
        data: {
          complexId: complex.id,
          vehicleId: vehicle.id,
          reportedById: user.id,
          description: "Test incident for OCC conditional update",
          status: "REPORTED",
        },
      });

      // Stale timestamp (1 hour ago)
      const staleTimestamp = new Date(Date.now() - 3600000);

      // Attempt conditional update with stale timestamp -> must match 0 rows
      const staleResult = await prisma.incident.updateMany({
        where: {
          id: incident.id,
          complexId: complex.id,
          updatedAt: staleTimestamp,
        },
        data: {
          status: "UNDER_INVESTIGATION",
        },
      });
      expect(staleResult.count).toBe(0);

      // Attempt conditional update with matching timestamp -> must match 1 row
      const validResult = await prisma.incident.updateMany({
        where: {
          id: incident.id,
          complexId: complex.id,
          updatedAt: incident.updatedAt,
        },
        data: {
          status: "UNDER_INVESTIGATION",
        },
      });
      expect(validResult.count).toBe(1);

      const updated = await prisma.incident.findUnique({
        where: { id: incident.id },
      });
      expect(updated?.status).toBe("UNDER_INVESTIGATION");
    } finally {
      await prisma.residentialComplex.delete({ where: { id: complex.id } });
    }
  });
});
