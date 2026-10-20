// ParkCheck - Scheduling Engine & Overdue Evaluator
// Specification Reference: Section 3.2, 5.2, 6.1, 6.2, 14, 15

import {
  ComplexPolicy,
  InspectionTaskEntity,
  VehicleEntity,
  VehiclePresenceEntity,
  TaskStatus,
} from "./types";
import { addMinutes, isAfter, differenceInMinutes } from "date-fns";

export interface ScheduledTaskGenerationInput {
  complexId: string;
  policy: ComplexPolicy;
  currentTime: Date;
  vehicles: VehicleEntity[];
  presences: Map<string, VehiclePresenceEntity>; // vehicleId -> presence
  activeTasks: InspectionTaskEntity[]; // currently PENDING or OVERDUE
  lastCompletedInspections: Map<string, Date>; // vehicleId -> last inspection timestamp
}

export interface GeneratedScheduledTasksResult {
  newTasks: InspectionTaskEntity[];
  skippedVehicles: Array<{ vehicleId: string; reason: string }>;
}

/**
 * Generates scheduled inspection obligations according to complex policy.
 * Requirements:
 * 1. Only applies to vehicles expected to be INSIDE (or UNCERTAIN with flag).
 * 2. Strictly EXCLUDES vehicles marked AWAY.
 * 3. Does not generate duplicate pending tasks for the same vehicle.
 * 4. Checks returnSatisfiesScheduledPolicy: if configured to WITHIN_WINDOW,
 *    a recent return task completed within returnWindowMinutes satisfies the upcoming slot.
 */
export function generateScheduledRounds(
  input: ScheduledTaskGenerationInput
): GeneratedScheduledTasksResult {
  const {
    complexId,
    policy,
    currentTime,
    vehicles,
    presences,
    activeTasks,
    lastCompletedInspections,
  } = input;

  const newTasks: InspectionTaskEntity[] = [];
  const skippedVehicles: Array<{ vehicleId: string; reason: string }> = [];

  // Group active tasks by vehicleId
  const activeTaskMap = new Map<string, InspectionTaskEntity[]>();
  for (const task of activeTasks) {
    if (task.status === "PENDING" || task.status === "OVERDUE") {
      const list = activeTaskMap.get(task.vehicleId) || [];
      list.push(task);
      activeTaskMap.set(task.vehicleId, list);
    }
  }

  for (const vehicle of vehicles) {
    if (!vehicle.active) {
      skippedVehicles.push({ vehicleId: vehicle.id, reason: "Vehicle inactive" });
      continue;
    }

    const presence = presences.get(vehicle.id);
    const status = presence?.currentStatus || "INSIDE"; // default inside if not set

    // Rule: Exclude vehicles marked AWAY
    if (status === "AWAY") {
      skippedVehicles.push({
        vehicleId: vehicle.id,
        reason: "Vehicle currently marked AWAY (excluded from parking obligations)",
      });
      continue;
    }

    // Rule: Avoid duplicate active scheduled tasks
    const existingActive = activeTaskMap.get(vehicle.id) || [];
    const hasActiveScheduled = existingActive.some((t) => t.triggerType === "SCHEDULED");
    if (hasActiveScheduled) {
      skippedVehicles.push({
        vehicleId: vehicle.id,
        reason: "Active scheduled inspection already outstanding",
      });
      continue;
    }

    // Rule: Check policy on whether a recent return inspection satisfies scheduled inspection
    const lastInspectionTime = lastCompletedInspections.get(vehicle.id);
    if (lastInspectionTime) {
      const minutesSinceLast = differenceInMinutes(currentTime, lastInspectionTime);

      if (
        policy.returnSatisfiesScheduledPolicy === "WITHIN_WINDOW" &&
        minutesSinceLast < policy.returnWindowMinutes
      ) {
        skippedVehicles.push({
          vehicleId: vehicle.id,
          reason: `Recent return inspection satisfied interval (${minutesSinceLast}m ago < ${policy.returnWindowMinutes}m window)`,
        });
        continue;
      }

      if (minutesSinceLast < policy.inspectionIntervalMinutes) {
        skippedVehicles.push({
          vehicleId: vehicle.id,
          reason: `Inspection interval not elapsed (${minutesSinceLast}m < ${policy.inspectionIntervalMinutes}m)`,
        });
        continue;
      }
    }

    // Create scheduled inspection task
    const dueAt = addMinutes(currentTime, policy.overdueGraceMinutes);
    const task: InspectionTaskEntity = {
      id: `task-sched-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`,
      complexId,
      vehicleId: vehicle.id,
      triggerType: "SCHEDULED",
      status: "PENDING",
      dueAt,
      completedAt: null,
      isLate: false,
      createdAt: currentTime,
      updatedAt: currentTime,
    };

    newTasks.push(task);
  }

  return { newTasks, skippedVehicles };
}

/**
 * Server-side Overdue Evaluator:
 * Inspects all PENDING tasks and transitions those past (dueAt + overdueGraceMinutes) to OVERDUE.
 * Retains task identity and history. Late completions will be marked isLate = true.
 */
export function evaluateOverdueTasks(
  tasks: InspectionTaskEntity[],
  policy: ComplexPolicy,
  currentTime: Date
): {
  transitionedToOverdue: InspectionTaskEntity[];
  escalationRequired: InspectionTaskEntity[];
} {
  const transitionedToOverdue: InspectionTaskEntity[] = [];
  const escalationRequired: InspectionTaskEntity[] = [];

  for (const task of tasks) {
    if (task.status === "PENDING") {
      const deadline = addMinutes(task.dueAt, policy.overdueGraceMinutes);
      if (isAfter(currentTime, deadline)) {
        task.status = "OVERDUE";
        task.updatedAt = currentTime;
        transitionedToOverdue.push(task);
      }
    }

    // Check if task has been overdue long enough to warrant supervisor escalation alert
    if (task.status === "OVERDUE") {
      const minutesOverdue = differenceInMinutes(currentTime, task.dueAt);
      if (minutesOverdue >= policy.overdueEscalationMinutes) {
        escalationRequired.push(task);
      }
    }
  }

  return { transitionedToOverdue, escalationRequired };
}

/**
 * Inspection submission logic:
 * Completes a task, recording whether it was completed late, or marked UNABLE_TO_COMPLETE.
 * Note: UNABLE_TO_COMPLETE does NOT satisfy the task as COMPLETED.
 */
export function submitTaskResult(
  task: InspectionTaskEntity,
  submissionTime: Date,
  resultType: "COMPLETED" | "UNABLE_TO_COMPLETE",
  unableReason?: string
): InspectionTaskEntity {
  const isLate = task.status === "OVERDUE" || isAfter(submissionTime, task.dueAt);

  if (resultType === "UNABLE_TO_COMPLETE") {
    return {
      ...task,
      status: "UNABLE_TO_COMPLETE",
      completedAt: null, // Not completed
      isLate,
      unableToCompleteReason: unableReason || "No reason specified",
      updatedAt: submissionTime,
    };
  }

  return {
    ...task,
    status: "COMPLETED",
    completedAt: submissionTime,
    isLate,
    updatedAt: submissionTime,
  };
}
