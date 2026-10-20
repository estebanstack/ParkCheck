// ParkCheck - Vehicle Movement & Presence State Machine
// Specification Reference: Section 3.1, 5.1, 5.4, 6.3, 15

import {
  MovementType,
  PresenceStatus,
  ComplexPolicy,
  VehiclePresenceEntity,
  MovementEventEntity,
  InspectionTaskEntity,
} from "./types";
import { addMinutes } from "date-fns";

export interface RecordMovementInput {
  complexId: string;
  vehicleId: string;
  eventType: MovementType;
  recordedAt: Date;
  recordedById?: string | null;
  source?: string;
  idempotencyKey?: string | null;
  notes?: string | null;
}

export interface MovementProcessingResult {
  movementEvent: MovementEventEntity;
  updatedPresence: VehiclePresenceEntity;
  newReturnTask?: InspectionTaskEntity;
  outstandingTasksKept: string[]; // IDs of tasks preserved across departure
  notes?: string;
}

/**
 * Checks whether an incoming movement is a duplicate within the configured cooldown.
 */
export function isDuplicateMovement(
  lastMovement: MovementEventEntity | null,
  newEventType: MovementType,
  newRecordedAt: Date,
  cooldownSeconds: number
): boolean {
  if (!lastMovement) return false;
  if (lastMovement.eventType !== newEventType) return false;

  const diffMs = Math.abs(newRecordedAt.getTime() - lastMovement.recordedAt.getTime());
  return diffMs < cooldownSeconds * 1000;
}

/**
 * Evaluates the new presence status given a recorded movement event.
 * Note: Inspections NEVER change presence. Only arrivals/departures or authorized verifications do.
 */
export function derivePresenceFromMovement(
  currentStatus: PresenceStatus,
  eventType: MovementType
): PresenceStatus {
  if (eventType === "ARRIVAL") {
    return "INSIDE";
  }
  if (eventType === "DEPARTURE") {
    return "AWAY";
  }
  return currentStatus;
}

/**
 * Core business rule: On vehicle arrival, a RETURN inspection task must be created.
 * Due date is calculated using the complex's return inspection policy (provisional default: within returnWindowMinutes).
 */
export function buildReturnInspectionTask(
  complexId: string,
  vehicleId: string,
  movementEventId: string,
  recordedAt: Date,
  policy: ComplexPolicy
): InspectionTaskEntity {
  const dueAt = addMinutes(recordedAt, policy.returnWindowMinutes);
  return {
    id: `task-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`,
    complexId,
    vehicleId,
    triggerType: "RETURN",
    status: "PENDING",
    dueAt,
    completedAt: null,
    isLate: false,
    relatedMovementId: movementEventId,
    createdAt: recordedAt,
    updatedAt: recordedAt,
  };
}

/**
 * Core business rule: When a vehicle departs with pending/unresolved inspection tasks:
 * 1. Mark presence AWAY.
 * 2. PRESERVE all outstanding tasks and movement events.
 * 3. Never falsely mark tasks COMPLETED or silently delete them.
 */
export function handleVehicleDeparture(
  existingTasks: InspectionTaskEntity[],
  departureEvent: MovementEventEntity,
  policy: ComplexPolicy
): {
  updatedPresenceStatus: PresenceStatus;
  preservedTaskIds: string[];
  reviewNotice?: string;
} {
  const pendingTasks = existingTasks.filter(
    (t) => t.status === "PENDING" || t.status === "OVERDUE"
  );

  const preservedTaskIds = pendingTasks.map((t) => t.id);

  let reviewNotice: string | undefined;
  if (pendingTasks.length > 0) {
    if (policy.departureWithPendingTaskPolicy === "FLAG_FOR_SUPERVISOR_REVIEW") {
      reviewNotice = `Vehicle departed with ${pendingTasks.length} unresolved inspection obligation(s). Flagged for supervisor review.`;
    }
  }

  return {
    updatedPresenceStatus: "AWAY",
    preservedTaskIds,
    reviewNotice,
  };
}
