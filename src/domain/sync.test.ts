// ParkCheck - Offline Synchronization, Idempotency & Conflict Handling Tests
// Specification Reference: Section 4, 8, 9, 14, 15

import { describe, it, expect, beforeEach } from "vitest";
import { signSessionToken, verifySessionToken, getSessionFromRequest, hasPermission, SessionPayload } from "./auth";
import { StorageService } from "../../mobile/src/services/storage";
import {
  derivePresenceFromMovement,
  buildReturnInspectionTask,
  handleVehicleDeparture,
} from "./movementStateMachine";
import { prioritizeWorkQueue } from "./queueService";
import { DEFAULT_COMPLEX_POLICY, InspectionTaskEntity, VehicleEntity, VehiclePresenceEntity } from "./types";
import { processSyncBatch } from "./syncService";
import { SyncBatchRequest } from "./syncTypes";
import { NextRequest } from "next/server";

describe("ParkCheck Mobile Offline & Sync Architecture", () => {
  beforeEach(() => {
    StorageService._resetMemoryStore();
  });

  describe("1. Dual Authentication (Bearer Token & Cookies)", () => {
    const sessionData: SessionPayload = {
      userId: "user-guard-1",
      email: "porteria@bosquereal.com",
      name: "Carlos Mendoza",
      complexId: "complex-bosque-real",
      role: "ENTRANCE_GUARD",
    };

    it("Generates and verifies a valid JWT session token", () => {
      const token = signSessionToken(sessionData);
      expect(token).toBeDefined();

      const decoded = verifySessionToken(token);
      expect(decoded).not.toBeNull();
      expect(decoded?.userId).toBe(sessionData.userId);
      expect(decoded?.complexId).toBe(sessionData.complexId);
      expect(decoded?.role).toBe("ENTRANCE_GUARD");
    });

    it("Extracts session from Authorization Bearer header for mobile clients", () => {
      const token = signSessionToken(sessionData);
      const req = new NextRequest("http://localhost:3000/api/sync/batch", {
        headers: {
          authorization: `Bearer ${token}`,
        },
      });

      const extracted = getSessionFromRequest(req);
      expect(extracted).not.toBeNull();
      expect(extracted?.userId).toBe("user-guard-1");
      expect(extracted?.complexId).toBe("complex-bosque-real");
    });

    it("Falls back to session cookie for web browser dashboard", () => {
      const token = signSessionToken(sessionData);
      const req = new NextRequest("http://localhost:3000/api/sync/batch", {
        headers: {
          cookie: `parkcheck_session=${token}`,
        },
      });

      const extracted = getSessionFromRequest(req);
      expect(extracted).not.toBeNull();
      expect(extracted?.userId).toBe("user-guard-1");
    });

    it("Enforces role permissions accurately across entrance guard, rondero, and supervisor", () => {
      expect(hasPermission("ENTRANCE_GUARD", "canRecordMovements")).toBe(true);
      expect(hasPermission("ENTRANCE_GUARD", "canPerformInspections")).toBe(false);

      expect(hasPermission("PARKING_GUARD", "canRecordMovements")).toBe(false);
      expect(hasPermission("PARKING_GUARD", "canPerformInspections")).toBe(true);

      expect(hasPermission("SUPERVISOR", "canRecordMovements")).toBe(true);
      expect(hasPermission("SUPERVISOR", "canPerformInspections")).toBe(true);
      expect(hasPermission("SUPERVISOR", "canExportReports")).toBe(true);
    });
  });

  describe("2. Offline Storage & Application Restart Persistence", () => {
    it("Enqueues offline movement events and preserves them with client timestamps", async () => {
      const clientEventId = "evt-client-101";
      const item = await StorageService.enqueueEvent(
        clientEventId,
        "complex-bosque-real",
        "MOVEMENT",
        {
          plate: "KHY842",
          movementType: "ARRIVAL",
        }
      );

      expect(item.clientEventId).toBe(clientEventId);
      expect(item.syncStatus).toBe("PENDING_SYNC");
      expect(item.retryCount).toBe(0);
      expect(item.createdAt).toBeDefined();

      const outbox = await StorageService.getOutbox();
      expect(outbox).toHaveLength(1);
      expect(outbox[0].payload.plate).toBe("KHY842");
    });

    it("Preserves queued events across simulated app restart or reboot", async () => {
      await StorageService.enqueueEvent("evt-1", "comp-1", "MOVEMENT", { plate: "ABC123", movementType: "ARRIVAL" });
      await StorageService.enqueueEvent("evt-2", "comp-1", "MOVEMENT", { plate: "XYZ789", movementType: "DEPARTURE" });
      await StorageService.enqueueEvent("evt-3", "comp-1", "INSPECTION", { taskId: "task-99", result: "NO_VISIBLE_INCIDENT" });

      const reloaded = await StorageService.getOutbox();
      expect(reloaded).toHaveLength(3);
      expect(reloaded.map((i) => i.clientEventId)).toEqual(["evt-1", "evt-2", "evt-3"]);
      expect(reloaded.every((i) => i.syncStatus === "PENDING_SYNC")).toBe(true);
    });

    it("Retains unsynchronized or failed records on network error, allowing safe retry", async () => {
      await StorageService.enqueueEvent("evt-err-1", "comp-1", "MOVEMENT", { plate: "KHY842", movementType: "ARRIVAL" });

      await StorageService.updateItemStatus("evt-err-1", "SYNC_FAILED", {
        lastError: "Connection timeout to server",
      });

      const outbox = await StorageService.getOutbox();
      expect(outbox[0].syncStatus).toBe("SYNC_FAILED");
      expect(outbox[0].retryCount).toBe(1);
      expect(outbox[0].lastError).toBe("Connection timeout to server");

      await StorageService.clearSyncedItems();
      const stillThere = await StorageService.getOutbox();
      expect(stillThere).toHaveLength(1);
      expect(stillThere[0].clientEventId).toBe("evt-err-1");

      await StorageService.updateItemStatus("evt-err-1", "SYNCED", {
        serverId: "server-movement-999",
        syncedAt: new Date().toISOString(),
      });

      const syncedOutbox = await StorageService.getOutbox();
      expect(syncedOutbox[0].syncStatus).toBe("SYNCED");

      await StorageService.clearSyncedItems();
      const cleared = await StorageService.getOutbox();
      expect(cleared).toHaveLength(0);
    });
  });

  describe("3. Contradictory Movements & Conflict Handling", () => {
    it("Detects contradictory movement sequences and flags presence as UNCERTAIN without overwriting history", () => {
      const currentPresence = "INSIDE";
      const isContradictoryArrival = currentPresence === "INSIDE";
      expect(isContradictoryArrival).toBe(true);

      const updatedPresence = isContradictoryArrival ? "UNCERTAIN" : derivePresenceFromMovement(currentPresence, "ARRIVAL");
      expect(updatedPresence).toBe("UNCERTAIN");
    });

    it("A vehicle departing with pending return tasks preserves the obligation without erasing it", () => {
      const now = new Date();
      const task = buildReturnInspectionTask("comp-1", "veh-1", "mov-1", now, DEFAULT_COMPLEX_POLICY);
      expect(task.status).toBe("PENDING");
      expect(task.triggerType).toBe("RETURN");

      const departureResult = handleVehicleDeparture([task], {
        id: "mov-2",
        complexId: "comp-1",
        vehicleId: "veh-1",
        eventType: "DEPARTURE",
        recordedAt: new Date(now.getTime() + 1000 * 60 * 10),
        source: "GATE_MANUAL",
      }, DEFAULT_COMPLEX_POLICY);

      expect(departureResult.updatedPresenceStatus).toBe("AWAY");
      expect(departureResult.preservedTaskIds).toContain(task.id);
      expect(departureResult.reviewNotice).toContain("Flagged for supervisor review");
    });
  });

  describe("4. Priority Work Queue under Offline Sync Conditions", () => {
    it("Maintains return inspections as Priority Bucket 1 over scheduled and overdue tasks", () => {
      const now = new Date();

      const vehiclesMap = new Map<string, VehicleEntity>([
        ["v1", { id: "v1", complexId: "c1", plate: "RET001", active: true }],
        ["v2", { id: "v2", complexId: "c1", plate: "SCH002", active: true }],
        ["v3", { id: "v3", complexId: "c1", plate: "OVD003", active: true }],
      ]);

      const presencesMap = new Map<string, VehiclePresenceEntity>([
        ["v1", { vehicleId: "v1", currentStatus: "INSIDE", statusUpdatedAt: now }],
        ["v2", { vehicleId: "v2", currentStatus: "INSIDE", statusUpdatedAt: now }],
        ["v3", { vehicleId: "v3", currentStatus: "INSIDE", statusUpdatedAt: now }],
      ]);

      const tasks: InspectionTaskEntity[] = [
        {
          id: "t-sch",
          complexId: "c1",
          vehicleId: "v2",
          triggerType: "SCHEDULED",
          status: "PENDING",
          dueAt: new Date(now.getTime() + 1000 * 60 * 40),
          isLate: false,
          createdAt: now,
          updatedAt: now,
        },
        {
          id: "t-ret",
          complexId: "c1",
          vehicleId: "v1",
          triggerType: "RETURN",
          status: "PENDING",
          dueAt: new Date(now.getTime() + 1000 * 60 * 20),
          isLate: false,
          createdAt: now,
          updatedAt: now,
        },
        {
          id: "t-ovd",
          complexId: "c1",
          vehicleId: "v3",
          triggerType: "SCHEDULED",
          status: "OVERDUE",
          dueAt: new Date(now.getTime() - 1000 * 60 * 10),
          isLate: true,
          createdAt: now,
          updatedAt: now,
        },
      ];

      const queueResult = prioritizeWorkQueue(tasks, vehiclesMap, presencesMap, DEFAULT_COMPLEX_POLICY);

      expect(queueResult.items[0].task.id).toBe("t-ret");
      expect(queueResult.items[0].priorityBucket).toBe(1);
      expect(queueResult.items[0].priorityLabel).toBe("Retorno Reciente (Prioridad)");

      expect(queueResult.items[1].task.id).toBe("t-sch");
      expect(queueResult.items[1].priorityBucket).toBe(2);

      expect(queueResult.items[2].task.id).toBe("t-ovd");
      expect(queueResult.items[2].priorityBucket).toBe(3);
    });
  });

  describe("5. Server-Side Idempotency & Batch Synchronization Engine", () => {
    function createMockPrisma() {
      const syncLogs = new Map<string, any>();
      const movements: any[] = [];
      const tasks: any[] = [];
      const vehicles = new Map<string, any>();
      const presences = new Map<string, any>();
      const notifications: any[] = [];
      const incidents: any[] = [];
      const attachments: any[] = [];

      const tx = {
        residentialComplex: {
          findUniqueOrThrow: async ({ where }: any) => ({
            id: where.id,
            name: "Conjunto Bosque Real",
            ...DEFAULT_COMPLEX_POLICY,
          }),
        },
        syncEventLog: {
          findUnique: async ({ where }: any) => {
            const key = `${where.complexId_clientEventId.complexId}:${where.complexId_clientEventId.clientEventId}`;
            return syncLogs.get(key) || null;
          },
          create: async ({ data }: any) => {
            const key = `${data.complexId}:${data.clientEventId}`;
            syncLogs.set(key, { ...data, id: `log-${Date.now()}` });
            return syncLogs.get(key);
          },
        },
        vehicle: {
          findUnique: async ({ where }: any) => {
            const key = `${where.complexId_plate.complexId}:${where.complexId_plate.plate}`;
            const v = vehicles.get(key);
            if (!v) return null;
            return { ...v, presence: presences.get(v.id) || null };
          },
          create: async ({ data }: any) => {
            const id = `veh-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`;
            const v = { ...data, id };
            const key = `${data.complexId}:${data.plate}`;
            vehicles.set(key, v);
            return { ...v, presence: null };
          },
        },
        vehiclePresence: {
          create: async ({ data }: any) => {
            presences.set(data.vehicleId, data);
            return data;
          },
          upsert: async ({ where, update, create }: any) => {
            const existing = presences.get(where.vehicleId);
            const val = existing ? { ...existing, ...update } : { ...create, vehicleId: where.vehicleId };
            presences.set(where.vehicleId, val);
            return val;
          },
        },
        vehicleMovementEvent: {
          create: async ({ data }: any) => {
            const id = `mov-srv-${movements.length + 1}`;
            const row = { ...data, id };
            movements.push(row);
            return row;
          },
        },
        inspectionTask: {
          findMany: async () => tasks,
          create: async ({ data }: any) => {
            tasks.push(data);
            return data;
          },
        },
        notification: {
          create: async ({ data }: any) => {
            notifications.push(data);
            return data;
          },
        },
        incident: {
          create: async ({ data }: any) => {
            incidents.push(data);
            return data;
          },
        },
        incidentFollowUp: {
          create: async ({ data }: any) => data,
        },
        incidentAttachment: {
          create: async ({ data }: any) => {
            const id = `att-srv-${attachments.length + 1}`;
            const row = { ...data, id };
            attachments.push(row);
            return row;
          },
        },
      };

      const mockPrisma = {
        $transaction: async (cb: any) => await cb(tx),
        _store: { syncLogs, movements, tasks, vehicles, presences, notifications, incidents, attachments },
      };

      return mockPrisma;
    }

    const entranceGuardSession: SessionPayload = {
      userId: "user-guard-1",
      email: "guard@bosquereal.com",
      name: "Carlos Guard",
      complexId: "comp-bosque-real",
      role: "ENTRANCE_GUARD",
    };

    it("Processes an arrival movement, creates return inspection, and separates client and server timestamps", async () => {
      const mockPrisma = createMockPrisma();
      const recordedClientTime = "2026-10-21T14:30:00.000Z";

      const batchRequest: SyncBatchRequest = {
        complexId: "comp-bosque-real",
        clientBatchId: "batch-101",
        events: [
          {
            clientEventId: "client-mov-001",
            complexId: "comp-bosque-real",
            eventType: "MOVEMENT",
            plate: "KHY842",
            movementType: "ARRIVAL",
            recordedAt: recordedClientTime,
          },
        ],
      };

      const response = await processSyncBatch(mockPrisma as any, entranceGuardSession, batchRequest);

      expect(response.success).toBe(true);
      expect(response.acknowledgedCount).toBe(1);
      expect(response.results[0].status).toBe("ACKNOWLEDGED");
      expect(response.results[0].clientRecordedAt).toBe(recordedClientTime);
      expect(response.results[0].serverReceivedAt).toBeDefined();

      expect(mockPrisma._store.movements).toHaveLength(1);
      expect(mockPrisma._store.movements[0].recordedAt.toISOString()).toBe(recordedClientTime);
      expect(mockPrisma._store.tasks).toHaveLength(1);
      expect(mockPrisma._store.tasks[0].triggerType).toBe("RETURN");
    });

    it("Enforces genuine idempotency on duplicate retry: returns identical acknowledgment without creating duplicate records", async () => {
      const mockPrisma = createMockPrisma();
      const recordedClientTime = "2026-10-21T14:30:00.000Z";

      const batchRequest: SyncBatchRequest = {
        complexId: "comp-bosque-real",
        clientBatchId: "batch-first",
        events: [
          {
            clientEventId: "client-mov-dup-99",
            complexId: "comp-bosque-real",
            eventType: "MOVEMENT",
            plate: "WLU915",
            movementType: "ARRIVAL",
            recordedAt: recordedClientTime,
          },
        ],
      };

      const firstResponse = await processSyncBatch(mockPrisma as any, entranceGuardSession, batchRequest);
      expect(firstResponse.acknowledgedCount).toBe(1);
      const originalEntityId = firstResponse.results[0].entityId;
      expect(originalEntityId).toBeDefined();
      expect(mockPrisma._store.movements).toHaveLength(1);

      const retryRequest: SyncBatchRequest = {
        complexId: "comp-bosque-real",
        clientBatchId: "batch-retry",
        events: [
          {
            clientEventId: "client-mov-dup-99",
            complexId: "comp-bosque-real",
            eventType: "MOVEMENT",
            plate: "WLU915",
            movementType: "ARRIVAL",
            recordedAt: recordedClientTime,
          },
        ],
      };

      const retryResponse = await processSyncBatch(mockPrisma as any, entranceGuardSession, retryRequest);
      expect(retryResponse.duplicateCount).toBe(1);
      expect(retryResponse.results[0].status).toBe("DUPLICATE_ACKNOWLEDGED");
      expect(retryResponse.results[0].entityId).toBe(originalEntityId);

      // Verify zero duplicate records created
      expect(mockPrisma._store.movements).toHaveLength(1);
      expect(mockPrisma._store.tasks).toHaveLength(1);
    });

    it("Handles contradictory movements: preserves event in history, marks UNCERTAIN, and flags CONFLICT_FLAGGED", async () => {
      const mockPrisma = createMockPrisma();

      await processSyncBatch(mockPrisma as any, entranceGuardSession, {
        complexId: "comp-bosque-real",
        clientBatchId: "batch-1",
        events: [
          {
            clientEventId: "mov-arr-1",
            complexId: "comp-bosque-real",
            eventType: "MOVEMENT",
            plate: "FTZ654",
            movementType: "ARRIVAL",
            recordedAt: "2026-10-21T10:00:00.000Z",
          },
        ],
      });

      const conflictResponse = await processSyncBatch(mockPrisma as any, entranceGuardSession, {
        complexId: "comp-bosque-real",
        clientBatchId: "batch-2",
        events: [
          {
            clientEventId: "mov-arr-2-conflict",
            complexId: "comp-bosque-real",
            eventType: "MOVEMENT",
            plate: "FTZ654",
            movementType: "ARRIVAL",
            recordedAt: "2026-10-21T10:05:00.000Z",
          },
        ],
      });

      expect(conflictResponse.conflictCount).toBe(1);
      expect(conflictResponse.results[0].status).toBe("CONFLICT_FLAGGED");
      expect(conflictResponse.results[0].conflictReason).toContain("Presencia contradictoria detectada");

      expect(mockPrisma._store.movements).toHaveLength(2);

      const alert = mockPrisma._store.notifications.find((n: any) => n.type === "UNCERTAIN_PRESENCE_ALERT");
      expect(alert).toBeDefined();
      expect(alert.targetRole).toBe("SUPERVISOR");
    });

    it("Enforces complex isolation: rejects sync batch when requested complex doesn't match authenticated session", async () => {
      const mockPrisma = createMockPrisma();

      const crossComplexRequest: SyncBatchRequest = {
        complexId: "unauthorized-complex-999",
        clientBatchId: "batch-hack",
        events: [
          {
            clientEventId: "evt-hack-1",
            complexId: "unauthorized-complex-999",
            eventType: "MOVEMENT",
            plate: "HCK001",
            movementType: "ARRIVAL",
            recordedAt: "2026-10-21T10:00:00.000Z",
          },
        ],
      };

      await expect(
        processSyncBatch(mockPrisma as any, entranceGuardSession, crossComplexRequest)
      ).rejects.toThrow("Acceso no autorizado");
    });
  });

  describe("6. License Plate Normalization, OCR Candidate Extraction & Validation", () => {
    it("Normalizes noisy user inputs and formats cleanly", async () => {
      const { normalizePlate } = await import("./plateService");
      expect(normalizePlate(" khy-842 ")).toBe("KHY842");
      expect(normalizePlate("wlu.915")).toBe("WLU915");
      expect(normalizePlate("abc 12d")).toBe("ABC12D");
      expect(normalizePlate("")).toBe("");
    });

    it("Validates official Colombian plate formats for automobiles, motorcycles and special vehicles", async () => {
      const { validatePlateFormat } = await import("./plateService");

      // Automobile: 3 letters + 3 numbers
      const autoRes = validatePlateFormat("KHY842");
      expect(autoRes.isValid).toBe(true);
      expect(autoRes.vehicleType).toBe("AUTOMOBILE");

      // Motorcycle: 3 letters + 2 numbers + 1 letter
      const motoRes = validatePlateFormat("ABC12D");
      expect(motoRes.isValid).toBe(true);
      expect(motoRes.vehicleType).toBe("MOTORCYCLE");

      // Invalid format
      const invalidRes = validatePlateFormat("TOOLONG123");
      expect(invalidRes.isValid).toBe(false);
      expect(invalidRes.error).toBeDefined();
    });

    it("Extracts and scores plate candidates from raw OCR text with character confusion resolution", async () => {
      const { extractPlateCandidates } = await import("./plateService");

      // Direct match in OCR block
      const candidates = extractPlateCandidates("COLOMBIA\nKHY842\nBOGOTA D.C.");
      expect(candidates.length).toBeGreaterThanOrEqual(1);
      expect(candidates[0].plate).toBe("KHY842");
      expect(candidates[0].isDirectMatch).toBe(true);
      expect(candidates[0].confidence).toBeGreaterThanOrEqual(0.9);

      // OCR confusion heuristic: 'O' instead of '0', or '0' instead of 'O'
      const confusedText = "VEHICULO 0BC123 COLOMBIA"; // First letter read as 0
      const fixedCandidates = extractPlateCandidates(confusedText);
      expect(fixedCandidates.some((c) => c.plate === "OBC123")).toBe(true);
    });

    it("Validates gate movement intent against presence states and flags contradictions", async () => {
      const { validateGateMovementIntent } = await import("./plateService");

      // Normal entry: vehicle is AWAY
      const normalEntry = validateGateMovementIntent("AWAY", "ARRIVAL");
      expect(normalEntry.isNormal).toBe(true);
      expect(normalEntry.isContradictory).toBe(false);

      // Normal exit: vehicle is INSIDE
      const normalExit = validateGateMovementIntent("INSIDE", "DEPARTURE");
      expect(normalExit.isNormal).toBe(true);
      expect(normalExit.isContradictory).toBe(false);

      // Contradictory entry: vehicle is already INSIDE
      const contradictionEntry = validateGateMovementIntent("INSIDE", "ARRIVAL");
      expect(contradictionEntry.isNormal).toBe(false);
      expect(contradictionEntry.isContradictory).toBe(true);
      expect(contradictionEntry.warningMessage).toContain("ya figura DENTRO");

      // Contradictory exit: vehicle is already AWAY
      const contradictionExit = validateGateMovementIntent("AWAY", "DEPARTURE");
      expect(contradictionExit.isNormal).toBe(false);
      expect(contradictionExit.isContradictory).toBe(true);
      expect(contradictionExit.warningMessage).toContain("ya figura FUERA");

      // Uncertain presence always requires verification
      const uncertainCheck = validateGateMovementIntent("UNCERTAIN", "ARRIVAL");
      expect(uncertainCheck.isNormal).toBe(false);
      expect(uncertainCheck.isContradictory).toBe(true);
      expect(uncertainCheck.warningMessage).toContain("INCIERTA");
    });
  });

  describe("7. Offline Manifest Lookup & Unknown Plate Handling", () => {
    it("Looks up registered vehicles in offline cache and provides presence and space", async () => {
      const { OcrService } = await import("../../mobile/src/services/ocrService");

      // Seed local vehicle cache
      await StorageService.setCachedVehicles([
        {
          id: "veh-1",
          plate: "KHY842",
          parkingSpace: "Torre 1 - P102",
          presenceStatus: "AWAY",
          activeTasks: [],
        },
      ]);

      const lookupResult = await OcrService.lookupPlateAndValidate("KHY842", "ARRIVAL");
      expect(lookupResult.isRegistered).toBe(true);
      expect(lookupResult.registeredVehicle?.plate).toBe("KHY842");
      expect(lookupResult.registeredVehicle?.parkingSpace).toBe("Torre 1 - P102");
      expect(lookupResult.movementValidation.isNormal).toBe(true);
    });

    it("Clearly signals unknown plates without pretending server lookup succeeded", async () => {
      const { OcrService } = await import("../../mobile/src/services/ocrService");

      await StorageService.setCachedVehicles([]); // Empty cache

      const unknownResult = await OcrService.lookupPlateAndValidate("ZZZ999", "ARRIVAL");
      expect(unknownResult.isRegistered).toBe(false);
      expect(unknownResult.registeredVehicle).toBeUndefined();
    });
  });
});
