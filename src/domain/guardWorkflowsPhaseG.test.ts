// ParkCheck Phase G Verification Test Suite
// Verifies:
// 1. Camera capture calling real OCR engine without random simulation.
// 2. OCR failure reporting and manual plate entry fallback.
// 3. Ensuring no random or simulated plate can be accepted as a real scan.
// 4. Portería entry and exit without mandatory photographs.
// 5. Rondas inspection workflows: Sin novedad (no photo required), Con novedad (requires description + photo), No posible (requires reason).
// 6. Preservation of unrelated inspection obligations upon single task completion.
// 7. Novedades standalone incident reporting and shift history.
// 8. Shared vehicle identity across Portería, Rondas, and Novedades.
// 9. Offline persistence and sync status distinctions.
// 10. Prevention of duplicate incidents and duplicate movements.

import { describe, it, expect, beforeEach } from "vitest";
import { OcrService } from "../../mobile/src/services/ocrService";
import { StorageService } from "../../mobile/src/services/storage";
import {
  normalizePlate,
  validatePlateFormat,
  extractPlateCandidates,
  validateGateMovementIntent,
} from "./plateService";

describe("Phase G - Real Guard Workflows, OCR Integrity & Zero Simulation", () => {
  beforeEach(() => {
    StorageService._resetMemoryStore();
  });

  describe("1. Real Camera OCR & Candidate Extraction", () => {
    it("processes genuine recognized text and extracts Colombian candidates without simulation", async () => {
      // Mock genuine ML Kit response with raw text from camera capture
      const mockMlKit = {
        recognize: async (uri: string) => {
          expect(uri).toContain("file://");
          return {
            text: "REPUBLICA DE COLOMBIA\nKHY-842\nBOGOTA D.C.",
            blocks: [],
          };
        },
      };

      OcrService._setNativeDriver(mockMlKit);

      const response = await OcrService.scanPlateFromImage(
        "file:///cache/camera/plate_capture_001.jpg",
        "ARRIVAL"
      );

      expect(response.success).toBe(true);
      expect(response.result).toBeDefined();
      expect(response.result?.selectedPlate).toBe("KHY842");
      expect(response.result?.candidates.length).toBeGreaterThan(0);
      expect(response.result?.candidates[0].plate).toBe("KHY842");
      expect(response.result?.candidates[0].vehicleType).toBe("AUTOMOBILE");
      expect(response.result?.candidates[0].isDirectMatch).toBe(true);
    });

    it("handles motorcycle plates with correct format (3 letters + 2 digits + 1 letter)", async () => {
      const mockMlKit = {
        recognize: async () => ({
          text: "COLOMBIA\nABC-12D\nMEDELLIN",
          blocks: [],
        }),
      };
      OcrService._setNativeDriver(mockMlKit);

      const response = await OcrService.scanPlateFromImage(
        "file:///cache/camera/moto_001.jpg",
        "ARRIVAL"
      );

      expect(response.success).toBe(true);
      expect(response.result?.selectedPlate).toBe("ABC12D");
      expect(response.result?.candidates[0].vehicleType).toBe("MOTORCYCLE");
    });

    it("returns actionable failure and does NOT invent a plate when image contains no readable plate", async () => {
      // Mock ML Kit returning unreadable text or noise
      const mockMlKit = {
        recognize: async () => ({
          text: "CHEVROLET TRACKER TURBO 2024",
          blocks: [],
        }),
      };
      OcrService._setNativeDriver(mockMlKit);

      const response = await OcrService.scanPlateFromImage(
        "file:///cache/camera/blurry_capture.jpg",
        "ARRIVAL"
      );

      // Must fail cleanly, never returning a random or simulated plate
      expect(response.success).toBe(false);
      expect(response.result).toBeUndefined();
      expect(response.error).toContain("no corresponde a un formato de placa colombiana válido");
    });

    it("returns actionable error when image is completely blank or dark", async () => {
      const mockMlKit = {
        recognize: async () => ({
          text: "   ",
          blocks: [],
        }),
      };
      OcrService._setNativeDriver(mockMlKit);

      const response = await OcrService.scanPlateFromImage(
        "file:///cache/camera/dark_photo.jpg"
      );

      expect(response.success).toBe(false);
      expect(response.error).toContain("No se detectó ningún texto");
    });

    it("manual fallback allows immediate typing when camera or OCR fails", async () => {
      // Guard types plate manually
      const manualInput = "xyz 789";
      const validation = validatePlateFormat(manualInput);
      expect(validation.isValid).toBe(true);
      expect(validation.normalizedPlate).toBe("XYZ789");

      const lookup = await OcrService.lookupPlateAndValidate(validation.normalizedPlate, "ARRIVAL");
      expect(lookup.selectedPlate).toBe("XYZ789");
      expect(lookup.isRegistered).toBe(false); // Unregistered visitor
    });
  });

  describe("2. Portería - Movement Registration Without Mandatory Photos", () => {
    it("allows ordinary ARRIVAL without requiring any photograph", async () => {
      // Pre-seed an authorized vehicle
      await StorageService.setCachedVehicles([
        {
          id: "veh-001",
          plate: "KHY842",
          parkingSpace: "Torre 1 - 201",
          presenceStatus: "AWAY",
          activeTasks: [],
        },
      ]);

      const clientEventId = "evt-arr-test-1";
      const complexId = "comp-001";

      // 1. Enqueue outbox movement without photo attachment
      const item = await StorageService.enqueueEvent(clientEventId, complexId, "MOVEMENT", {
        plate: "KHY842",
        movementType: "ARRIVAL",
        notes: "Llega residente habitual",
        source: "CAMERA_OCR",
      });

      expect(item.payload.photoUri).toBeUndefined();
      expect(item.syncStatus).toBe("PENDING_SYNC");

      // 2. Update cache
      const updated = await StorageService.recordMovementInCache("KHY842", "ARRIVAL");
      expect(updated.presenceStatus).toBe("INSIDE");
      expect(updated.activeTasks.length).toBe(1);
      expect(updated.activeTasks[0].triggerType).toBe("RETURN");
    });

    it("allows ordinary DEPARTURE without requiring any photograph", async () => {
      await StorageService.setCachedVehicles([
        {
          id: "veh-002",
          plate: "WLU915",
          parkingSpace: "Torre 2 - 304",
          presenceStatus: "INSIDE",
          activeTasks: [
            {
              id: "task-prev-01",
              triggerType: "SCHEDULED",
              status: "PENDING",
              dueAt: "2026-10-26T18:00:00Z",
              description: "Ronda rutinaria nocturna",
            },
          ],
        },
      ]);

      const updated = await StorageService.recordMovementInCache("WLU915", "DEPARTURE");
      expect(updated.presenceStatus).toBe("AWAY");
      // Critical domain invariant: Pending tasks are PRESERVED upon departure
      expect(updated.activeTasks.length).toBe(1);
      expect(updated.activeTasks[0].id).toBe("task-prev-01");
    });

    it("flags contradictory movement if vehicle already inside attempts arrival", () => {
      const result = validateGateMovementIntent("INSIDE", "ARRIVAL");
      expect(result.isNormal).toBe(false);
      expect(result.isContradictory).toBe(true);
      expect(result.warningMessage).toContain("ya figura DENTRO");
    });

    it("flags contradictory movement if vehicle already away attempts departure", () => {
      const result = validateGateMovementIntent("AWAY", "DEPARTURE");
      expect(result.isNormal).toBe(false);
      expect(result.isContradictory).toBe(true);
      expect(result.warningMessage).toContain("ya figura FUERA");
    });
  });

  describe("3. Rondas - Vehicle Inspection Results & Obligation Handling", () => {
    it("completes inspection as 'Sin novedad' without forcing a photograph", async () => {
      await StorageService.setCachedVehicles([
        {
          id: "veh-insp-1",
          plate: "KHY842",
          parkingSpace: "T1-101",
          presenceStatus: "INSIDE",
          activeTasks: [
            {
              id: "task-ret-01",
              triggerType: "RETURN",
              status: "PENDING",
              dueAt: "2026-10-26T14:30:00Z",
            },
          ],
        },
      ]);

      // Complete task
      await StorageService.completeTaskInCache("task-ret-01", {
        result: "NO_VISIBLE_INCIDENT",
      });

      const vehicles = await StorageService.getCachedVehicles();
      const v = vehicles.find((veh) => veh.plate === "KHY842");

      expect(v?.activeTasks.length).toBe(0);
      expect(v?.completedTasks?.length).toBe(1);
      expect(v?.completedTasks?.[0].outcomeResult).toBe("NO_VISIBLE_INCIDENT");
      expect(v?.completedTasks?.[0].status).toBe("COMPLETED");
    });

    it("preserves unrelated obligations when one specific task is completed", async () => {
      await StorageService.setCachedVehicles([
        {
          id: "veh-multi-task",
          plate: "FTZ654",
          presenceStatus: "INSIDE",
          activeTasks: [
            {
              id: "task-return-urgent",
              triggerType: "RETURN",
              status: "PENDING",
              dueAt: "2026-10-26T14:00:00Z",
            },
            {
              id: "task-routine-night",
              triggerType: "SCHEDULED",
              status: "PENDING",
              dueAt: "2026-10-26T22:00:00Z",
            },
          ],
        },
      ]);

      // Complete only the return task
      await StorageService.completeTaskInCache("task-return-urgent", {
        result: "NO_VISIBLE_INCIDENT",
      });

      const vehicles = await StorageService.getCachedVehicles();
      const v = vehicles.find((veh) => veh.plate === "FTZ654");

      // The unrelated scheduled night round must remain intact!
      expect(v?.activeTasks.length).toBe(1);
      expect(v?.activeTasks[0].id).toBe("task-routine-night");
      expect(v?.completedTasks?.length).toBe(1);
      expect(v?.completedTasks?.[0].id).toBe("task-return-urgent");
    });

    it("requires description and supports real photo attachment when damage is observed", async () => {
      const damageDescription = "Raspón profundo en guardabarros delantero derecho con pérdida de pintura";
      const photoUri = "file:///storage/emulated/0/DCIM/Camera/damage_khy842.jpg";

      await StorageService.setCachedVehicles([
        {
          id: "veh-damage",
          plate: "KHY842",
          presenceStatus: "INSIDE",
          activeTasks: [
            {
              id: "task-damage-01",
              triggerType: "SCHEDULED",
              status: "PENDING",
              dueAt: "2026-10-26T15:00:00Z",
            },
          ],
        },
      ]);

      // Complete inspection with damage
      await StorageService.completeTaskInCache("task-damage-01", {
        result: "DAMAGE_OBSERVED",
        description: damageDescription,
      });

      // Save local incident link
      await StorageService.saveLocalIncident({
        id: "inc-dmg-01",
        clientEventId: "evt-dmg-01",
        plate: "KHY842",
        category: "DAÑO_EN_RONDA",
        description: damageDescription,
        surveillanceRequired: true,
        ownerContactRequired: true,
        photoUri,
        recordedAt: new Date().toISOString(),
        reportedBy: "Guarda Carlos Gómez",
      });

      const incidents = await StorageService.getLocalIncidents();
      expect(incidents.length).toBe(1);
      expect(incidents[0].plate).toBe("KHY842");
      expect(incidents[0].photoUri).toBe(photoUri);
      expect(incidents[0].description).toBe(damageDescription);
      expect(incidents[0].surveillanceRequired).toBe(true);
    });

    it("records reason when inspection was unable to be completed", async () => {
      const reason = "Vehículo tapado con pijama impermeable sujeta a los rines con candado";

      await StorageService.setCachedVehicles([
        {
          id: "veh-unable",
          plate: "UVR330",
          presenceStatus: "INSIDE",
          activeTasks: [
            {
              id: "task-unable-01",
              triggerType: "SCHEDULED",
              status: "PENDING",
              dueAt: "2026-10-26T16:00:00Z",
            },
          ],
        },
      ]);

      await StorageService.completeTaskInCache("task-unable-01", {
        result: "UNABLE_TO_COMPLETE",
        unableReason: reason,
      });

      const vehicles = await StorageService.getCachedVehicles();
      const v = vehicles.find((veh) => veh.plate === "UVR330");

      expect(v?.activeTasks.length).toBe(0);
      expect(v?.completedTasks?.[0].status).toBe("UNABLE_TO_COMPLETE");
      expect(v?.completedTasks?.[0].unableReason).toBe(reason);
    });
  });

  describe("4. Shared Vehicle Identity Across Workflows", () => {
    it("ensures Portería, Rondas, and Novedades reference the same vehicle identity and manifest", async () => {
      // 1. Portería creates visitor vehicle during arrival
      const arrivalVeh = await StorageService.recordMovementInCache("ABC123", "ARRIVAL", {
        notes: "Visitante no censado apto 501",
      });
      expect(arrivalVeh.plate).toBe("ABC123");
      expect(arrivalVeh.presenceStatus).toBe("INSIDE");

      // 2. Rondas identifies this vehicle by plate
      const rondaVeh = await StorageService.getVehicleByPlate("abc-123");
      expect(rondaVeh).not.toBeNull();
      expect(rondaVeh?.id).toBe(arrivalVeh.id);
      expect(rondaVeh?.presenceStatus).toBe("INSIDE");
      expect(rondaVeh?.activeTasks.length).toBe(1); // Return task created from arrival

      // 3. Novedades references same vehicle
      const novelVeh = await StorageService.ensureVehicleInCache("ABC123");
      expect(novelVeh.id).toBe(arrivalVeh.id);

      // Total vehicles in cache remains 1 (no duplicates!)
      const allVehicles = await StorageService.getCachedVehicles();
      const matching = allVehicles.filter((v) => normalizePlate(v.plate) === "ABC123");
      expect(matching.length).toBe(1);
    });
  });

  describe("5. Standalone Novedades Workflow & Shift History", () => {
    it("records standalone incident and lists it in shift history", async () => {
      const incidentRecord = {
        id: "inc-stand-01",
        clientEventId: "evt-inc-01",
        plate: "WLU915",
        category: "VENTANA_ABIERTA",
        description: "Ventana del copiloto totalmente abierta sin ocupantes",
        surveillanceRequired: false,
        ownerContactRequired: true,
        recordedAt: new Date().toISOString(),
        reportedBy: "Guarda Juan David",
      };

      await StorageService.saveLocalIncident(incidentRecord);

      const history = await StorageService.getLocalIncidents();
      expect(history.length).toBe(1);
      expect(history[0].plate).toBe("WLU915");
      expect(history[0].category).toBe("VENTANA_ABIERTA");
      expect(history[0].reportedBy).toBe("Guarda Juan David");
    });

    it("prevents duplicate incident entries if identical clientEventId is submitted twice", async () => {
      const item = {
        id: "inc-dup-test",
        clientEventId: "client-unique-999",
        plate: "KHY842",
        description: "Rayón superficial",
        surveillanceRequired: false,
        ownerContactRequired: false,
        recordedAt: new Date().toISOString(),
        reportedBy: "Guarda Esteban",
      };

      await StorageService.saveLocalIncident(item);
      // Attempt second submission with same clientEventId
      await StorageService.saveLocalIncident(item);

      const history = await StorageService.getLocalIncidents();
      expect(history.filter((h) => h.clientEventId === "client-unique-999").length).toBe(1);
    });
  });

  describe("6. Outbox Idempotency & Offline Persistence", () => {
    it("enqueues outbox items idempotently without duplicates", async () => {
      const clientEventId = "unique-client-event-101";

      const item1 = await StorageService.enqueueEvent(clientEventId, "complex-01", "MOVEMENT", {
        plate: "KHY842",
        movementType: "ARRIVAL",
      });

      const item2 = await StorageService.enqueueEvent(clientEventId, "complex-01", "MOVEMENT", {
        plate: "KHY842",
        movementType: "ARRIVAL",
      });

      expect(item1.clientEventId).toBe(item2.clientEventId);

      const outbox = await StorageService.getOutbox();
      expect(outbox.filter((o) => o.clientEventId === clientEventId).length).toBe(1);
    });

    it("clearly distinguishes PENDING_SYNC from SYNCED states", async () => {
      const clientEventId = "sync-state-test-01";
      await StorageService.enqueueEvent(clientEventId, "complex-01", "MOVEMENT", {
        plate: "KHY842",
        movementType: "ARRIVAL",
      });

      let outbox = await StorageService.getOutbox();
      expect(outbox[0].syncStatus).toBe("PENDING_SYNC");

      // Update to SYNCED
      await StorageService.updateItemStatus(clientEventId, "SYNCED", {
        serverId: "srv-mov-9988",
        syncedAt: new Date().toISOString(),
      });

      outbox = await StorageService.getOutbox();
      expect(outbox[0].syncStatus).toBe("SYNCED");
      expect(outbox[0].serverId).toBe("srv-mov-9988");
    });
  });
});
