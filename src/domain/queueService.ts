// ParkCheck - Work Queue Prioritization Engine
// Specification Reference: Section 3.3, 6.2, 14

import {
  ComplexPolicy,
  InspectionTaskEntity,
  VehicleEntity,
  VehiclePresenceEntity,
  PresenceStatus,
} from "./types";

export interface PrioritizedQueueItem {
  task: InspectionTaskEntity;
  vehicle: VehicleEntity;
  presenceStatus: PresenceStatus;
  priorityBucket: 1 | 2 | 3 | 4;
  priorityLabel: string;
}

/**
 * Present work in this order by default (Section 6.2):
 * 1. Recently returned vehicles with pending return inspections (RETURN & PENDING).
 * 2. Other vehicles with due scheduled inspections (SCHEDULED & PENDING).
 * 3. Outstanding overdue tasks and unresolved inspection failures (OVERDUE | UNABLE_TO_COMPLETE).
 * 4. Vehicles with uncertain presence requiring verification (Displayed as separate alert category).
 *
 * Guaranteed: Never hides outstanding scheduled or overdue tasks when arrival flow is high.
 */
export function prioritizeWorkQueue(
  tasks: InspectionTaskEntity[],
  vehiclesMap: Map<string, VehicleEntity>,
  presencesMap: Map<string, VehiclePresenceEntity>,
  policy: ComplexPolicy
): {
  items: PrioritizedQueueItem[];
  uncertainAlerts: Array<{ vehicle: VehicleEntity; presence: VehiclePresenceEntity }>;
  totalCounts: {
    pendingReturn: number;
    pendingScheduled: number;
    overdue: number;
    unableToComplete: number;
    uncertain: number;
  };
} {
  const items: PrioritizedQueueItem[] = [];

  let pendingReturn = 0;
  let pendingScheduled = 0;
  let overdue = 0;
  let unableToComplete = 0;

  for (const task of tasks) {
    if (task.status === "COMPLETED" || task.status === "CANCELLED") {
      continue;
    }

    const vehicle = vehiclesMap.get(task.vehicleId);
    if (!vehicle) continue;

    const presence = presencesMap.get(task.vehicleId);
    const presenceStatus = presence?.currentStatus || "INSIDE";

    let priorityBucket: 1 | 2 | 3 | 4 = 2;
    let priorityLabel = "Inspección Programada";

    if (task.triggerType === "RETURN" && task.status === "PENDING") {
      priorityBucket = 1;
      priorityLabel = "Retorno Reciente (Prioridad)";
      pendingReturn++;
    } else if (task.status === "OVERDUE") {
      priorityBucket = 3;
      priorityLabel = "Inspección Vencida";
      overdue++;
    } else if (task.status === "UNABLE_TO_COMPLETE") {
      priorityBucket = 3;
      priorityLabel = "Fallo / No Completada";
      unableToComplete++;
    } else if (task.triggerType === "SCHEDULED" && task.status === "PENDING") {
      priorityBucket = 2;
      priorityLabel = "Ronda Programada";
      pendingScheduled++;
    }

    items.push({
      task,
      vehicle,
      presenceStatus,
      priorityBucket,
      priorityLabel,
    });
  }

  // Sort by bucket (1 -> 2 -> 3), then by earliest dueAt
  items.sort((a, b) => {
    if (a.priorityBucket !== b.priorityBucket) {
      return a.priorityBucket - b.priorityBucket;
    }
    return a.task.dueAt.getTime() - b.task.dueAt.getTime();
  });

  // Collect uncertain presence alerts
  const uncertainAlerts: Array<{ vehicle: VehicleEntity; presence: VehiclePresenceEntity }> = [];
  for (const [vehicleId, presence] of presencesMap.entries()) {
    if (presence.currentStatus === "UNCERTAIN") {
      const vehicle = vehiclesMap.get(vehicleId);
      if (vehicle) {
        uncertainAlerts.push({ vehicle, presence });
      }
    }
  }

  return {
    items,
    uncertainAlerts,
    totalCounts: {
      pendingReturn,
      pendingScheduled,
      overdue,
      unableToComplete,
      uncertain: uncertainAlerts.length,
    },
  };
}
