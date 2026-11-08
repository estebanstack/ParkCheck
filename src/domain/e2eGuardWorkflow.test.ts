// ParkCheck - End-to-End Guard Workflow Verification Tests
// Specification Reference: Phase C, Section 2

import { describe, it, expect, beforeEach } from "vitest";
import { signSessionToken, verifySessionToken, hasPermission, SessionPayload } from "./auth";
import { StorageService } from "../../mobile/src/services/storage";
import { OcrService } from "../../mobile/src/services/ocrService";
import {
  normalizePlate,
  validatePlateFormat,
  extractPlateCandidates,
  validateGateMovementIntent,
} from "./plateService";
import { DEFAULT_COMPLEX_POLICY } from "./types";
import { processSyncBatch } from "./syncService";
import { SyncBatchRequest } from "./syncTypes";

describe("Phase C: End-to-End Guard Workflow & Lifecycle Verification", () => {
  beforeEach(() => {
    StorageService._resetMemoryStore();
  });

  // Reusable in-memory Prisma mock store
  function createE2EMockStore() {
    const syncLogs = new Map<string, any>();
    const movements: any[] = [];
    const tasks: any[] = [];
    const vehicles = new Map<string, any>();
    const presences = new Map<string, any>();
    const notifications: any[] = [];
    const auditLogs: any[] = [];

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
          const id = `mov-${movements.length + 1}`;
          const row = { ...data, id };
          movements.push(row);
          return row;
        },
      },
      inspectionTask: {
        findMany: async ({ where }: any) => {
          return tasks.filter((t) => t.vehicleId === where.vehicleId && where.status.in.includes(t.status));
        },
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
      auditLog: {
        create: async ({ data }: any) => {
          auditLogs.push(data);
          return data;
        },
      },
    };

    return {
      $transaction: async (cb: any) => await cb(tx),
      _store: { syncLogs, movements, tasks, vehicles, presences, notifications, auditLogs },
    };
  }

  const guardSession: SessionPayload = {
    userId: "guard-carlos-1",
    email: "porteria@bosquereal.com",
    name: "Carlos Mendoza (Guarda)",
    complexId: "comp-bosque-real",
    role: "ENTRANCE_GUARD",
  };

  it("Executes the complete Guard workflow: Register -> Sign in -> Entry -> Presence Update -> Exit -> Preserved Obligations", async () => {
    const store = createE2EMockStore();
    const complexId = "comp-bosque-real";

    // Step 1: Vehicle is registered in the database (e.g. by supervisor)
    const rawPlate = "khy-842";
    const validation = validatePlateFormat(rawPlate);
    expect(validation.isValid).toBe(true);
    expect(validation.normalizedPlate).toBe("KHY842");

    // Seed vehicle as registered with initial presence AWAY
    const vehicleKey = `${complexId}:KHY842`;
    const registeredVehicle = {
      id: "veh-khy842",
      complexId,
      plate: "KHY842",
      parkingSpace: "Torre 1 - P102",
      stickerToken: "NFC-PC-KHY842",
      active: true,
    };
    store._store.vehicles.set(vehicleKey, registeredVehicle);
    store._store.presences.set("veh-khy842", {
      vehicleId: "veh-khy842",
      currentStatus: "AWAY",
      statusUpdatedAt: new Date("2026-10-21T08:00:00Z"),
    });

    // Populate local mobile cache (as downloaded from /api/sync/manifest)
    await StorageService.setCachedVehicles([
      {
        id: "veh-khy842",
        plate: "KHY842",
        parkingSpace: "Torre 1 - P102",
        stickerToken: "NFC-PC-KHY842",
        presenceStatus: "AWAY",
        activeTasks: [],
      },
    ]);

    // Step 2: Guard signs in
    const token = signSessionToken(guardSession);
    const verified = verifySessionToken(token);
    expect(verified?.userId).toBe(guardSession.userId);
    expect(hasPermission(guardSession.role, "canRecordMovements")).toBe(true);

    // Step 3: Guard selects "Registrar entrada" (ARRIVAL)
    const intendedMovement = "ARRIVAL";

    // Step 4: Plate is identified via OCR / search
    const ocrLookup = await OcrService.lookupPlateAndValidate("KHY842", intendedMovement);
    expect(ocrLookup.isRegistered).toBe(true);
    expect(ocrLookup.registeredVehicle?.plate).toBe("KHY842");
    expect(ocrLookup.movementValidation.isNormal).toBe(true);
    expect(ocrLookup.movementValidation.isContradictory).toBe(false);

    // Step 5: Guard confirms vehicle and records entry (offline outbox enqueue)
    const arrivalClientEventId = "evt-arr-001";
    const clientTimestamp = "2026-10-21T14:00:00.000Z";

    await StorageService.enqueueEvent(arrivalClientEventId, complexId, "MOVEMENT", {
      plate: "KHY842",
      movementType: "ARRIVAL",
      source: "CAMERA_OCR",
    });

    // Verify outbox state
    const outbox = await StorageService.getOutbox();
    expect(outbox).toHaveLength(1);
    expect(outbox[0].syncStatus).toBe("PENDING_SYNC");

    // Step 6: Connectivity restores, batch sync processes the arrival
    const arrivalBatch: SyncBatchRequest = {
      complexId,
      clientBatchId: "batch-arr-1",
      events: [
        {
          clientEventId: arrivalClientEventId,
          complexId,
          eventType: "MOVEMENT",
          plate: "KHY842",
          movementType: "ARRIVAL",
          recordedAt: clientTimestamp,
        },
      ],
    };

    const arrivalSyncRes = await processSyncBatch(store as any, guardSession, arrivalBatch);
    expect(arrivalSyncRes.success).toBe(true);
    expect(arrivalSyncRes.acknowledgedCount).toBe(1);
    expect(arrivalSyncRes.results[0].status).toBe("ACKNOWLEDGED");

    // Step 7: Verify presence update and RETURN inspection task creation
    const updatedPresenceAfterArrival = store._store.presences.get("veh-khy842");
    expect(updatedPresenceAfterArrival.currentStatus).toBe("INSIDE");

    expect(store._store.tasks).toHaveLength(1);
    const returnTask = store._store.tasks[0];
    expect(returnTask.triggerType).toBe("RETURN");
    expect(returnTask.status).toBe("PENDING");
    expect(returnTask.vehicleId).toBe("veh-khy842");

    // Notification broadcasted to ronderos
    const guardNotification = store._store.notifications.find((n: any) => n.type === "RETURN_INSPECTION_CREATED");
    expect(guardNotification).toBeDefined();
    expect(guardNotification.targetRole).toBe("PARKING_GUARD");

    // Step 8: Guard selects "Registrar salida" (DEPARTURE) later
    const departureIntent = "DEPARTURE";

    // Validate exit compatibility: vehicle is currently INSIDE -> normal exit
    const exitLookup = await OcrService.lookupPlateAndValidate("KHY842", departureIntent);
    // In live app, local cache reflects updated presence INSIDE
    const exitValidation = validateGateMovementIntent("INSIDE", departureIntent);
    expect(exitValidation.isNormal).toBe(true);
    expect(exitValidation.isContradictory).toBe(false);

    // Record departure offline
    const departureClientEventId = "evt-dep-002";
    const departureClientTimestamp = "2026-10-21T14:45:00.000Z";

    const departureBatch: SyncBatchRequest = {
      complexId,
      clientBatchId: "batch-dep-2",
      events: [
        {
          clientEventId: departureClientEventId,
          complexId,
          eventType: "MOVEMENT",
          plate: "KHY842",
          movementType: "DEPARTURE",
          recordedAt: departureClientTimestamp,
        },
      ],
    };

    const departureSyncRes = await processSyncBatch(store as any, guardSession, departureBatch);
    expect(departureSyncRes.acknowledgedCount).toBe(1);

    // Step 9: Verify departure updates presence to AWAY, but PRESERVES the outstanding return task!
    const presenceAfterDeparture = store._store.presences.get("veh-khy842");
    expect(presenceAfterDeparture.currentStatus).toBe("AWAY");

    // CRITICAL DOMAIN RULE: Task is still PENDING and NOT deleted!
    expect(store._store.tasks).toHaveLength(1);
    expect(store._store.tasks[0].status).toBe("PENDING");
    expect(store._store.tasks[0].triggerType).toBe("RETURN");
  });

  it("Handles edge cases: Unknown plates, ambiguous OCR, duplicate movements, and UNCERTAIN presence", async () => {
    const store = createE2EMockStore();
    const complexId = "comp-bosque-real";

    // 1. Unknown plate
    const unknownLookup = await OcrService.lookupPlateAndValidate("ZZZ999", "ARRIVAL");
    expect(unknownLookup.isRegistered).toBe(false);
    expect(unknownLookup.registeredVehicle).toBeUndefined();

    // 2. Ambiguous OCR reading: '0' misread for letter 'O'
    const ocrCandidates = extractPlateCandidates("BOGOTA\n0BC123\nCOLOMBIA");
    expect(ocrCandidates.some((c) => c.plate === "OBC123")).toBe(true);

    // 3. Duplicate movement within cooldown: retry with same clientEventId
    const firstArrival = await processSyncBatch(store as any, guardSession, {
      complexId,
      clientBatchId: "b-1",
      events: [
        {
          clientEventId: "evt-dup-check",
          complexId,
          eventType: "MOVEMENT",
          plate: "FTZ654",
          movementType: "ARRIVAL",
          recordedAt: "2026-10-21T12:00:00Z",
        },
      ],
    });
    expect(firstArrival.acknowledgedCount).toBe(1);

    const retriedArrival = await processSyncBatch(store as any, guardSession, {
      complexId,
      clientBatchId: "b-2",
      events: [
        {
          clientEventId: "evt-dup-check",
          complexId,
          eventType: "MOVEMENT",
          plate: "FTZ654",
          movementType: "ARRIVAL",
          recordedAt: "2026-10-21T12:00:00Z",
        },
      ],
    });
    expect(retriedArrival.duplicateCount).toBe(1);
    expect(retriedArrival.results[0].status).toBe("DUPLICATE_ACKNOWLEDGED");

    // 4. UNCERTAIN presence warning
    const uncertainValidation = validateGateMovementIntent("UNCERTAIN", "ARRIVAL");
    expect(uncertainValidation.isContradictory).toBe(true);
    expect(uncertainValidation.warningMessage).toContain("INCIERTA");
  });
});
