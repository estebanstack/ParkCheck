// ParkCheck Mobile - Durable Outbox & Manifest Storage Service
// Guarantees persistence of queued events, shared vehicle identity,
// and audit history across app restarts and offline shifts.

import {
  OutboxItem,
  CachedVehicle,
  CachedTask,
  LocalIncidentRecord,
  AuthSession,
  SyncStatus,
} from "../types/outbox";
import { normalizePlate } from "../../../src/domain/plateService";

let AsyncStorage: any = null;
try {
  const mod = require("@react-native-async-storage/async-storage");
  AsyncStorage = mod?.default || mod;
} catch {
  AsyncStorage = null;
}

const STORAGE_KEYS = {
  OUTBOX: "@parkcheck_outbox_queue_v1",
  VEHICLES: "@parkcheck_cached_vehicles_v1",
  SESSION: "@parkcheck_auth_session_v1",
  OFFLINE_COUNTER: "@parkcheck_offline_counter_v1",
  INCIDENTS: "@parkcheck_local_incidents_v1",
};

// In-memory fallback if AsyncStorage is unavailable (e.g. during headless node testing)
let memoryStore: Record<string, string> = {};

async function getItem(key: string): Promise<string | null> {
  try {
    if (AsyncStorage?.getItem) {
      return await AsyncStorage.getItem(key);
    }
    return memoryStore[key] || null;
  } catch {
    return memoryStore[key] || null;
  }
}

async function setItem(key: string, value: string): Promise<void> {
  try {
    if (AsyncStorage?.setItem) {
      await AsyncStorage.setItem(key, value);
    }
    memoryStore[key] = value;
  } catch {
    memoryStore[key] = value;
  }
}

export const StorageService = {
  // --- OUTBOX QUEUE MANAGEMENT ---
  async getOutbox(): Promise<OutboxItem[]> {
    const raw = await getItem(STORAGE_KEYS.OUTBOX);
    if (!raw) return [];
    try {
      return JSON.parse(raw);
    } catch {
      return [];
    }
  },

  async enqueueEvent(
    clientEventId: string,
    complexId: string,
    eventType: OutboxItem["eventType"],
    payload: any
  ): Promise<OutboxItem> {
    const items = await this.getOutbox();

    // Idempotency: If clientEventId already enqueued, do not duplicate
    const existing = items.find((i) => i.clientEventId === clientEventId);
    if (existing) {
      return existing;
    }

    const newItem: OutboxItem = {
      clientEventId,
      complexId,
      eventType,
      payload,
      syncStatus: "PENDING_SYNC",
      createdAt: new Date().toISOString(),
      retryCount: 0,
    };

    items.push(newItem);
    await setItem(STORAGE_KEYS.OUTBOX, JSON.stringify(items));
    return newItem;
  },

  async updateItemStatus(
    clientEventId: string,
    status: SyncStatus,
    updates?: {
      serverId?: string;
      lastError?: string;
      conflictFlagged?: boolean;
      conflictReason?: string;
      syncedAt?: string;
    }
  ): Promise<void> {
    const items = await this.getOutbox();
    const index = items.findIndex((i) => i.clientEventId === clientEventId);
    if (index !== -1) {
      items[index] = {
        ...items[index],
        syncStatus: status,
        serverId: updates?.serverId ?? items[index].serverId,
        lastError: updates?.lastError,
        conflictFlagged: updates?.conflictFlagged ?? items[index].conflictFlagged,
        conflictReason: updates?.conflictReason ?? items[index].conflictReason,
        syncedAt: updates?.syncedAt ?? items[index].syncedAt,
        retryCount: status === "SYNC_FAILED" ? items[index].retryCount + 1 : items[index].retryCount,
      };
      await setItem(STORAGE_KEYS.OUTBOX, JSON.stringify(items));
    }
  },

  async clearSyncedItems(): Promise<void> {
    const items = await this.getOutbox();
    // Keep un-synced or failed items
    const remaining = items.filter((i) => i.syncStatus !== "SYNCED");
    await setItem(STORAGE_KEYS.OUTBOX, JSON.stringify(remaining));
  },

  // --- VEHICLE DIRECTORY CACHE ---
  async getCachedVehicles(): Promise<CachedVehicle[]> {
    const raw = await getItem(STORAGE_KEYS.VEHICLES);
    if (!raw) return [];
    try {
      return JSON.parse(raw);
    } catch {
      return [];
    }
  },

  async setCachedVehicles(vehicles: CachedVehicle[]): Promise<void> {
    await setItem(STORAGE_KEYS.VEHICLES, JSON.stringify(vehicles));
  },

  /**
   * Finds a vehicle by normalized plate in the local cache
   */
  async getVehicleByPlate(rawPlate: string): Promise<CachedVehicle | null> {
    const clean = normalizePlate(rawPlate);
    if (!clean) return null;
    const vehicles = await this.getCachedVehicles();
    return vehicles.find((v) => normalizePlate(v.plate) === clean) || null;
  },

  /**
   * Ensures a vehicle exists in local cache so Portería, Rondas, and Novedades
   * always reference the exact same underlying vehicle identity.
   */
  async ensureVehicleInCache(
    rawPlate: string,
    defaults?: Partial<CachedVehicle>
  ): Promise<CachedVehicle> {
    const clean = normalizePlate(rawPlate);
    const vehicles = await this.getCachedVehicles();
    let vehicle = vehicles.find((v) => normalizePlate(v.plate) === clean);

    if (vehicle) {
      // Update details if missing
      if (defaults?.parkingSpace && !vehicle.parkingSpace) {
        vehicle.parkingSpace = defaults.parkingSpace;
      }
      if (defaults?.make && !vehicle.make) {
        vehicle.make = defaults.make;
      }
      await this.setCachedVehicles(vehicles);
      return vehicle;
    }

    vehicle = {
      id: `veh_${clean}_${Date.now()}`,
      plate: clean,
      parkingSpace: defaults?.parkingSpace || null,
      stickerToken: defaults?.stickerToken || null,
      make: defaults?.make || null,
      model: defaults?.model || null,
      color: defaults?.color || null,
      presenceStatus: defaults?.presenceStatus || "AWAY",
      verificationDetails: defaults?.verificationDetails || "Vehículo registrado en operación local",
      activeTasks: defaults?.activeTasks || [],
      completedTasks: [],
    };

    vehicles.unshift(vehicle);
    await this.setCachedVehicles(vehicles);
    return vehicle;
  },

  /**
   * Applies a gate movement to the local vehicle cache:
   * - ARRIVAL: sets presence INSIDE, schedules a RETURN inspection task due in 30m.
   * - DEPARTURE: sets presence AWAY, preserves all pending obligations without deletion.
   */
  async recordMovementInCache(
    rawPlate: string,
    movementType: "ARRIVAL" | "DEPARTURE",
    options?: { notes?: string; source?: string; complexId?: string }
  ): Promise<CachedVehicle> {
    const cleanPlate = normalizePlate(rawPlate);
    const vehicles = await this.getCachedVehicles();
    let vehicle = vehicles.find((v) => normalizePlate(v.plate) === cleanPlate);

    const now = new Date();
    const dueAt = new Date(now.getTime() + 30 * 60 * 1000).toISOString();

    if (!vehicle) {
      // Create guest/visitor entry in local cache so presence and obligations can be tracked
      vehicle = {
        id: `veh_local_${Date.now()}_${cleanPlate}`,
        complexId: options?.complexId,
        plate: cleanPlate,
        parkingSpace: options?.notes?.includes("VISITANTE") ? "Visitante" : "No asignado",
        presenceStatus: movementType === "ARRIVAL" ? "INSIDE" : "AWAY",
        verificationDetails: options?.notes || `Movimiento registrado localmente (${movementType})`,
        activeTasks: [],
        completedTasks: [],
      };
      vehicles.push(vehicle);
    }

    if (movementType === "ARRIVAL") {
      vehicle.presenceStatus = "INSIDE";
      if (!Array.isArray(vehicle.activeTasks)) {
        vehicle.activeTasks = [];
      }
      // Schedule RETURN inspection task (high priority bucket)
      const returnTask: CachedTask = {
        id: `task-ret-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
        triggerType: "RETURN",
        status: "PENDING",
        dueAt,
        description: `Inspección de retorno prioritario - Ingreso ${now.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`,
      };
      vehicle.activeTasks.unshift(returnTask);
    } else {
      // DEPARTURE: Invariant: Presence is AWAY, but pending obligations are strictly PRESERVED
      vehicle.presenceStatus = "AWAY";
    }

    await this.setCachedVehicles(vehicles);
    return vehicle;
  },

  /**
   * Completes an inspection task in local cache:
   * - Sets completed state and outcome details.
   * - Removes the completed task from active queue.
   * - Preserves the completed task in vehicle audit history.
   * - Preserves all other unrelated pending tasks!
   */
  async completeTaskInCache(
    taskId: string,
    outcome?: {
      result: string;
      description?: string;
      unableReason?: string;
    }
  ): Promise<void> {
    const vehicles = await this.getCachedVehicles();
    let modified = false;

    for (const v of vehicles) {
      if (Array.isArray(v.activeTasks)) {
        const targetTask = v.activeTasks.find((t) => t.id === taskId);
        if (targetTask) {
          // Remove from active queue
          v.activeTasks = v.activeTasks.filter((t) => t.id !== taskId);

          // Record in audit history for this vehicle
          if (!Array.isArray(v.completedTasks)) {
            v.completedTasks = [];
          }
          const finishedTask: CachedTask = {
            ...targetTask,
            status: outcome?.result === "UNABLE_TO_COMPLETE" ? "UNABLE_TO_COMPLETE" : "COMPLETED",
            completedAt: new Date().toISOString(),
            outcomeResult: outcome?.result,
            description: outcome?.description || targetTask.description,
            unableReason: outcome?.unableReason,
          };
          v.completedTasks.unshift(finishedTask);
          if (v.completedTasks.length > 15) {
            v.completedTasks = v.completedTasks.slice(0, 15);
          }
          modified = true;
          break;
        }
      }
    }

    if (modified) {
      await this.setCachedVehicles(vehicles);
    }
  },

  /**
   * Creates an inspection task for a vehicle (e.g. ad-hoc routine round inspection)
   */
  async createTaskForVehicle(
    rawPlate: string,
    triggerType: "SCHEDULED" | "RETURN" = "SCHEDULED",
    description?: string
  ): Promise<CachedTask> {
    const clean = normalizePlate(rawPlate);
    const vehicle = await this.ensureVehicleInCache(clean);
    const now = new Date();

    const newTask: CachedTask = {
      id: `task-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
      triggerType,
      status: "PENDING",
      dueAt: new Date(now.getTime() + 60 * 60 * 1000).toISOString(),
      description: description || (triggerType === "RETURN" ? "Ronda de retorno prioritario" : "Ronda rutinaria de inspección"),
    };

    if (!Array.isArray(vehicle.activeTasks)) {
      vehicle.activeTasks = [];
    }
    vehicle.activeTasks.unshift(newTask);

    const vehicles = await this.getCachedVehicles();
    const idx = vehicles.findIndex((v) => normalizePlate(v.plate) === clean);
    if (idx !== -1) {
      vehicles[idx] = vehicle;
      await this.setCachedVehicles(vehicles);
    }

    return newTask;
  },

  /**
   * Registers a vehicle directly in the local cache
   */
  async registerVehicleInCache(data: {
    plate: string;
    parkingSpace?: string | null;
    stickerToken?: string | null;
    presenceStatus?: "INSIDE" | "AWAY";
    make?: string | null;
    model?: string | null;
    color?: string | null;
    complexId?: string;
  }): Promise<CachedVehicle> {
    const clean = normalizePlate(data.plate);
    const vehicles = await this.getCachedVehicles();
    const existing = vehicles.find((v) => normalizePlate(v.plate) === clean);

    if (existing) {
      throw new Error(`El vehículo con placa ${clean} ya se encuentra registrado.`);
    }

    const newVehicle: CachedVehicle = {
      id: `veh_reg_${Date.now()}_${clean}`,
      complexId: data.complexId,
      plate: clean,
      parkingSpace: data.parkingSpace || null,
      stickerToken: data.stickerToken || null,
      make: data.make || null,
      model: data.model || null,
      color: data.color || null,
      presenceStatus: data.presenceStatus || "INSIDE",
      verificationDetails: "Registro manual verificado",
      activeTasks: [],
      completedTasks: [],
    };

    vehicles.unshift(newVehicle);
    await this.setCachedVehicles(vehicles);
    return newVehicle;
  },

  // --- LOCAL SHIFT INCIDENTS LOG ---
  async getLocalIncidents(): Promise<LocalIncidentRecord[]> {
    const raw = await getItem(STORAGE_KEYS.INCIDENTS);
    if (!raw) return [];
    try {
      return JSON.parse(raw);
    } catch {
      return [];
    }
  },

  async saveLocalIncident(incident: LocalIncidentRecord): Promise<void> {
    const incidents = await this.getLocalIncidents();
    // Deduplication check by clientEventId
    if (incidents.some((i) => i.clientEventId === incident.clientEventId)) {
      return;
    }
    incidents.unshift(incident);
    await setItem(STORAGE_KEYS.INCIDENTS, JSON.stringify(incidents));
  },

  // --- AUTH SESSION ---
  async getSession(): Promise<AuthSession | null> {
    const raw = await getItem(STORAGE_KEYS.SESSION);
    if (!raw) return null;
    try {
      return JSON.parse(raw);
    } catch {
      return null;
    }
  },

  async setSession(session: AuthSession | null): Promise<void> {
    if (!session) {
      try {
        if (AsyncStorage?.removeItem) {
          await AsyncStorage.removeItem(STORAGE_KEYS.SESSION);
        }
        delete memoryStore[STORAGE_KEYS.SESSION];
      } catch {
        delete memoryStore[STORAGE_KEYS.SESSION];
      }
    } else {
      await setItem(STORAGE_KEYS.SESSION, JSON.stringify(session));
    }
  },

  // For testing
  _resetMemoryStore() {
    memoryStore = {};
  },
};
