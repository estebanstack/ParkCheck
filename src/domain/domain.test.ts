// ParkCheck - Acceptance Criteria Unit & State Machine Tests
// Specification Reference: Section 15

import { describe, it, expect } from "vitest";
import {
  derivePresenceFromMovement,
  isDuplicateMovement,
  buildReturnInspectionTask,
  handleVehicleDeparture,
} from "./movementStateMachine";
import {
  generateScheduledRounds,
  evaluateOverdueTasks,
  submitTaskResult,
} from "./schedulingEngine";
import { prioritizeWorkQueue } from "./queueService";
import {
  createDamageIncident,
  transitionIncidentStatus,
  recordSurveillanceOutcome,
  recordOwnerContact,
} from "./incidentService";
import {
  DEFAULT_COMPLEX_POLICY,
  ComplexPolicy,
  VehicleEntity,
  VehiclePresenceEntity,
  InspectionTaskEntity,
  MovementEventEntity,
} from "./types";
import { addMinutes, subMinutes } from "date-fns";

describe("ParkCheck Core Domain & Acceptance Criteria", () => {
  const policy: ComplexPolicy = { ...DEFAULT_COMPLEX_POLICY };
  const mockComplexId = "complex-1";
  const mockVehicleId = "veh-abc123";

  // Section 15.1: Vehicle movements
  describe("Vehicle movements & Presence Isolation", () => {
    it("Recording an arrival marks presence as INSIDE and creates a return-inspection task", () => {
      const now = new Date("2026-10-20T10:00:00Z");
      const presence = derivePresenceFromMovement("AWAY", "ARRIVAL");
      expect(presence).toBe("INSIDE");

      const returnTask = buildReturnInspectionTask(
        mockComplexId,
        mockVehicleId,
        "mov-1",
        now,
        policy
      );

      expect(returnTask.triggerType).toBe("RETURN");
      expect(returnTask.status).toBe("PENDING");
      expect(returnTask.dueAt.getTime()).toBe(
        addMinutes(now, policy.returnWindowMinutes).getTime()
      );
    });

    it("Recording a departure marks presence as AWAY without erasing pending inspection tasks", () => {
      const now = new Date("2026-10-20T10:00:00Z");
      const presence = derivePresenceFromMovement("INSIDE", "DEPARTURE");
      expect(presence).toBe("AWAY");

      const pendingTask: InspectionTaskEntity = {
        id: "task-pending-1",
        complexId: mockComplexId,
        vehicleId: mockVehicleId,
        triggerType: "RETURN",
        status: "PENDING",
        dueAt: addMinutes(now, 30),
        isLate: false,
        createdAt: now,
        updatedAt: now,
      };

      const departureEvent: MovementEventEntity = {
        id: "mov-dep-1",
        complexId: mockComplexId,
        vehicleId: mockVehicleId,
        eventType: "DEPARTURE",
        recordedAt: now,
        source: "GATE_MANUAL",
      };

      const result = handleVehicleDeparture([pendingTask], departureEvent, policy);

      expect(result.updatedPresenceStatus).toBe("AWAY");
      expect(result.preservedTaskIds).toContain("task-pending-1");
      expect(result.reviewNotice).toBeDefined();
    });

    it("Prevents accidental duplicate movements within cooldown window", () => {
      const t1 = new Date("2026-10-20T10:00:00Z");
      const t2 = new Date("2026-10-20T10:00:20Z"); // 20s later (< 60s)
      const t3 = new Date("2026-10-20T10:01:30Z"); // 90s later (> 60s)

      const lastMovement: MovementEventEntity = {
        id: "mov-1",
        complexId: mockComplexId,
        vehicleId: mockVehicleId,
        eventType: "ARRIVAL",
        recordedAt: t1,
        source: "GATE_MANUAL",
      };

      expect(isDuplicateMovement(lastMovement, "ARRIVAL", t2, policy.movementDedupSeconds)).toBe(true);
      expect(isDuplicateMovement(lastMovement, "ARRIVAL", t3, policy.movementDedupSeconds)).toBe(false);
      // Different event type within window is allowed (arrival then quick departure)
      expect(isDuplicateMovement(lastMovement, "DEPARTURE", t2, policy.movementDedupSeconds)).toBe(false);
    });
  });

  // Section 15.2: Inspection scheduling & Overdue evaluation
  describe("Inspection scheduling engine", () => {
    it("Excludes vehicles currently marked AWAY from scheduled inspection rounds", () => {
      const now = new Date("2026-10-20T12:00:00Z");
      const vehicles: VehicleEntity[] = [
        { id: "veh-inside", complexId: mockComplexId, plate: "INS001", active: true },
        { id: "veh-away", complexId: mockComplexId, plate: "AWY002", active: true },
      ];

      const presences = new Map<string, VehiclePresenceEntity>([
        ["veh-inside", { vehicleId: "veh-inside", currentStatus: "INSIDE", statusUpdatedAt: now }],
        ["veh-away", { vehicleId: "veh-away", currentStatus: "AWAY", statusUpdatedAt: now }],
      ]);

      const result = generateScheduledRounds({
        complexId: mockComplexId,
        policy,
        currentTime: now,
        vehicles,
        presences,
        activeTasks: [],
        lastCompletedInspections: new Map(),
      });

      expect(result.newTasks.length).toBe(1);
      expect(result.newTasks[0].vehicleId).toBe("veh-inside");
      expect(result.skippedVehicles.some((s) => s.vehicleId === "veh-away")).toBe(true);
    });

    it("Transitions pending tasks to OVERDUE once dueAt + grace period has passed", () => {
      const created = new Date("2026-10-20T10:00:00Z");
      const dueAt = new Date("2026-10-20T11:00:00Z");
      // Grace period = 15m. Deadline = 11:15:00Z
      const evaluationTimeBeforeDeadline = new Date("2026-10-20T11:10:00Z");
      const evaluationTimeAfterDeadline = new Date("2026-10-20T11:20:00Z");

      const task: InspectionTaskEntity = {
        id: "task-1",
        complexId: mockComplexId,
        vehicleId: mockVehicleId,
        triggerType: "SCHEDULED",
        status: "PENDING",
        dueAt,
        isLate: false,
        createdAt: created,
        updatedAt: created,
      };

      const eval1 = evaluateOverdueTasks([task], policy, evaluationTimeBeforeDeadline);
      expect(eval1.transitionedToOverdue.length).toBe(0);
      expect(task.status).toBe("PENDING");

      const eval2 = evaluateOverdueTasks([task], policy, evaluationTimeAfterDeadline);
      expect(eval2.transitionedToOverdue.length).toBe(1);
      expect(task.status).toBe("OVERDUE");
    });

    it("UNABLE_TO_COMPLETE does NOT count as a successful inspection and marks isLate if overdue", () => {
      const now = new Date("2026-10-20T12:00:00Z");
      const pastDue = subMinutes(now, 10);

      const task: InspectionTaskEntity = {
        id: "task-unable",
        complexId: mockComplexId,
        vehicleId: mockVehicleId,
        triggerType: "SCHEDULED",
        status: "PENDING",
        dueAt: pastDue,
        isLate: false,
        createdAt: subMinutes(now, 60),
        updatedAt: subMinutes(now, 60),
      };

      const submitted = submitTaskResult(
        task,
        now,
        "UNABLE_TO_COMPLETE",
        "Vehicle blocked by construction scaffolding"
      );

      expect(submitted.status).toBe("UNABLE_TO_COMPLETE");
      expect(submitted.completedAt).toBeNull(); // Still not completed
      expect(submitted.isLate).toBe(true);
      expect(submitted.unableToCompleteReason).toBe(
        "Vehicle blocked by construction scaffolding"
      );
    });

    it("Late completion preserves completion time and records isLate=true", () => {
      const now = new Date("2026-10-20T12:00:00Z");
      const pastDue = subMinutes(now, 30);

      const task: InspectionTaskEntity = {
        id: "task-late",
        complexId: mockComplexId,
        vehicleId: mockVehicleId,
        triggerType: "SCHEDULED",
        status: "OVERDUE",
        dueAt: pastDue,
        isLate: false,
        createdAt: subMinutes(now, 90),
        updatedAt: subMinutes(now, 30),
      };

      const completed = submitTaskResult(task, now, "COMPLETED");

      expect(completed.status).toBe("COMPLETED");
      expect(completed.completedAt).toEqual(now);
      expect(completed.isLate).toBe(true);
    });
  });

  // Section 15.3 & 6.2: Priority Queue and Uncertain Status
  describe("Work queue prioritization & Uncertain Presence", () => {
    it("Prioritizes return inspections over scheduled inspections while keeping overdue visible", () => {
      const now = new Date("2026-10-20T12:00:00Z");

      const v1: VehicleEntity = { id: "v1", complexId: mockComplexId, plate: "RET001", active: true };
      const v2: VehicleEntity = { id: "v2", complexId: mockComplexId, plate: "SCH002", active: true };
      const v3: VehicleEntity = { id: "v3", complexId: mockComplexId, plate: "OVD003", active: true };

      const vehiclesMap = new Map([["v1", v1], ["v2", v2], ["v3", v3]]);
      const presencesMap = new Map<string, VehiclePresenceEntity>([
        ["v1", { vehicleId: "v1", currentStatus: "INSIDE", statusUpdatedAt: now }],
        ["v2", { vehicleId: "v2", currentStatus: "INSIDE", statusUpdatedAt: now }],
        ["v3", { vehicleId: "v3", currentStatus: "INSIDE", statusUpdatedAt: now }],
      ]);

      const tasks: InspectionTaskEntity[] = [
        {
          id: "t-sched",
          complexId: mockComplexId,
          vehicleId: "v2",
          triggerType: "SCHEDULED",
          status: "PENDING",
          dueAt: addMinutes(now, 45),
          isLate: false,
          createdAt: now,
          updatedAt: now,
        },
        {
          id: "t-overdue",
          complexId: mockComplexId,
          vehicleId: "v3",
          triggerType: "SCHEDULED",
          status: "OVERDUE",
          dueAt: subMinutes(now, 10),
          isLate: true,
          createdAt: subMinutes(now, 70),
          updatedAt: now,
        },
        {
          id: "t-return",
          complexId: mockComplexId,
          vehicleId: "v1",
          triggerType: "RETURN",
          status: "PENDING",
          dueAt: addMinutes(now, 20),
          isLate: false,
          createdAt: now,
          updatedAt: now,
        },
      ];

      const queue = prioritizeWorkQueue(tasks, vehiclesMap, presencesMap, policy);

      expect(queue.items.length).toBe(3);
      // Priority 1: Return inspection
      expect(queue.items[0].task.id).toBe("t-return");
      expect(queue.items[0].priorityBucket).toBe(1);

      // Priority 2: Scheduled inspection
      expect(queue.items[1].task.id).toBe("t-sched");
      expect(queue.items[1].priorityBucket).toBe(2);

      // Priority 3: Overdue inspection
      expect(queue.items[2].task.id).toBe("t-overdue");
      expect(queue.items[2].priorityBucket).toBe(3);

      // Total counts preserve full visibility
      expect(queue.totalCounts.pendingReturn).toBe(1);
      expect(queue.totalCounts.pendingScheduled).toBe(1);
      expect(queue.totalCounts.overdue).toBe(1);
    });

    it("Surfaces UNCERTAIN vehicle presence as an alert category without marking absent", () => {
      const now = new Date("2026-10-20T12:00:00Z");
      const vUncertain: VehicleEntity = {
        id: "v-unc",
        complexId: mockComplexId,
        plate: "UNC999",
        active: true,
      };

      const vehiclesMap = new Map([["v-unc", vUncertain]]);
      const presencesMap = new Map<string, VehiclePresenceEntity>([
        [
          "v-unc",
          {
            vehicleId: "v-unc",
            currentStatus: "UNCERTAIN",
            verificationDetails: "Camera glare at entrance gate, manual verification required",
            statusUpdatedAt: now,
          },
        ],
      ]);

      const queue = prioritizeWorkQueue([], vehiclesMap, presencesMap, policy);

      expect(queue.uncertainAlerts.length).toBe(1);
      expect(queue.uncertainAlerts[0].vehicle.plate).toBe("UNC999");
      expect(queue.totalCounts.uncertain).toBe(1);
    });
  });

  // Section 15.5: Damage & Incident Handling
  describe("Incident handling & auditable follow-ups", () => {
    it("Creates an incident with REPORTED status, preserving original observation", () => {
      const now = new Date("2026-10-20T14:00:00Z");
      const incident = createDamageIncident({
        complexId: mockComplexId,
        vehicleId: mockVehicleId,
        reportedById: "guard-1",
        observedAt: now,
        description: "Scratches on front right bumper and broken fog light",
        surveillanceRequired: true,
        ownerContactRequired: true,
      });

      expect(incident.status).toBe("REPORTED");
      expect(incident.surveillanceRequired).toBe(true);
      expect(incident.ownerContactRequired).toBe(true);
      expect(incident.observedAt).toEqual(now);
      expect(incident.resolvedAt).toBeNull();
    });

    it("Appends surveillance review and owner contact follow-ups without overwriting original report", () => {
      const now = new Date("2026-10-20T14:00:00Z");
      const tReview = new Date("2026-10-20T14:30:00Z");
      const tContact = new Date("2026-10-20T15:00:00Z");

      const incident = createDamageIncident({
        complexId: mockComplexId,
        vehicleId: mockVehicleId,
        reportedById: "guard-1",
        observedAt: now,
        description: "Dent on left door",
        surveillanceRequired: true,
        ownerContactRequired: true,
      });

      // 1. Surveillance review
      const cctvResult = recordSurveillanceOutcome(
        incident,
        "Footage at 13:45 shows vehicle arriving already with dent",
        "supervisor-1",
        tReview
      );
      expect(cctvResult.updatedIncident.surveillanceOutcome).toContain("arriving already with dent");
      expect(cctvResult.followUp.actionType).toBe("SURVEILLANCE_REVIEW");

      // 2. Owner contact
      const contactResult = recordOwnerContact(
        cctvResult.updatedIncident,
        true,
        "Owner contacted via intercom. Acknowledged pre-existing damage.",
        "guard-gate-1",
        tContact
      );
      expect(contactResult.updatedIncident.status).toBe("OWNER_CONTACTED");
      expect(contactResult.followUp.actionType).toBe("OWNER_CONTACT_ATTEMPT");
      expect(contactResult.followUp.outcome).toBe("CONTACTED");

      // 3. Resolution
      const resolution = transitionIncidentStatus(
        contactResult.updatedIncident,
        "RESOLVED",
        "Pre-existing damage verified by camera footage and owner acknowledgement",
        "supervisor-1",
        new Date("2026-10-20T15:30:00Z")
      );
      expect(resolution.updatedIncident.status).toBe("RESOLVED");
      expect(resolution.updatedIncident.resolvedAt).toBeDefined();
      expect(resolution.updatedIncident.description).toBe("Dent on left door"); // Original remains intact
    });
  });
});
