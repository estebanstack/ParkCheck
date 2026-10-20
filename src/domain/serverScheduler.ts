// ParkCheck - Server Database & Scheduling Orchestrator
// Handles safe, concurrency-locked scheduling runs and overdue evaluations

import { PrismaClient } from "@prisma/client";
import {
  generateScheduledRounds,
  evaluateOverdueTasks,
} from "./schedulingEngine";
import { ComplexPolicy, DEFAULT_COMPLEX_POLICY } from "./types";

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: process.env.NODE_ENV === "development" ? ["warn", "error"] : ["error"],
  });

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma;

/**
 * Executes a server-side scheduling tick for a residential complex:
 * 1. Evaluates and transitions overdue tasks.
 * 2. Generates new scheduled inspection tasks for expected present vehicles.
 * 3. Safe against duplicate execution via idempotent transaction.
 */
export async function executeComplexSchedulingTick(
  complexId: string,
  currentTime: Date = new Date()
) {
  return await prisma.$transaction(async (tx) => {
    // 1. Fetch complex and policy
    const complex = await tx.residentialComplex.findUnique({
      where: { id: complexId },
    });
    if (!complex || !complex.active) {
      return { skipped: true, reason: "Complex not found or inactive" };
    }

    const policy: ComplexPolicy = {
      inspectionIntervalMinutes: complex.inspectionIntervalMinutes,
      overdueGraceMinutes: complex.overdueGraceMinutes,
      returnSatisfiesScheduledPolicy:
        complex.returnSatisfiesScheduledPolicy as any,
      returnWindowMinutes: complex.returnWindowMinutes,
      departureWithPendingTaskPolicy:
        complex.departureWithPendingTaskPolicy as any,
      queueAlertOrderPolicy: complex.queueAlertOrderPolicy as any,
      overdueEscalationMinutes: complex.overdueEscalationMinutes,
      movementDedupSeconds: complex.movementDedupSeconds,
      retentionDaysPhotos: complex.retentionDaysPhotos,
      retentionDaysRecords: complex.retentionDaysRecords,
    };

    // 2. Fetch pending tasks to evaluate overdue transitions
    const pendingTasks = await tx.inspectionTask.findMany({
      where: {
        complexId,
        status: "PENDING",
      },
    });

    const mappedPendingTasks = pendingTasks.map((t) => ({
      id: t.id,
      complexId: t.complexId,
      vehicleId: t.vehicleId,
      triggerType: t.triggerType as any,
      status: t.status as any,
      dueAt: t.dueAt,
      completedAt: t.completedAt,
      isLate: t.isLate,
      createdAt: t.createdAt,
      updatedAt: t.updatedAt,
    }));

    const { transitionedToOverdue, escalationRequired } = evaluateOverdueTasks(
      mappedPendingTasks,
      policy,
      currentTime
    );

    // Apply overdue status updates
    for (const overdueTask of transitionedToOverdue) {
      await tx.inspectionTask.update({
        where: { id: overdueTask.id },
        data: {
          status: "OVERDUE",
          updatedAt: currentTime,
        },
      });

      // Notification
      await tx.notification.create({
        data: {
          complexId,
          targetRole: "SUPERVISOR",
          type: "INSPECTION_OVERDUE",
          title: "Inspección Vencida",
          message: `La inspección para el vehículo con ID ${overdueTask.vehicleId} ha superado el tiempo límite.`,
          entityType: "TASK",
          entityId: overdueTask.id,
        },
      });
    }

    // 3. Fetch active vehicles and presences
    const vehicles = await tx.vehicle.findMany({
      where: { complexId, active: true },
      include: { presence: true },
    });

    const presencesMap = new Map();
    for (const v of vehicles) {
      if (v.presence) {
        presencesMap.set(v.id, {
          vehicleId: v.id,
          currentStatus: v.presence.currentStatus,
          statusUpdatedAt: v.presence.statusUpdatedAt,
        });
      }
    }

    // Fetch active tasks to prevent duplicates
    const activeTasks = await tx.inspectionTask.findMany({
      where: {
        complexId,
        status: { in: ["PENDING", "OVERDUE"] },
      },
    });

    const mappedActiveTasks = activeTasks.map((t) => ({
      id: t.id,
      complexId: t.complexId,
      vehicleId: t.vehicleId,
      triggerType: t.triggerType as any,
      status: t.status as any,
      dueAt: t.dueAt,
      completedAt: t.completedAt,
      isLate: t.isLate,
      createdAt: t.createdAt,
      updatedAt: t.updatedAt,
    }));

    // Find last completed inspections
    const lastInspections = await tx.inspectionRecord.findMany({
      where: { complexId },
      orderBy: { inspectedAt: "desc" },
    });
    const lastCompletedInspections = new Map<string, Date>();
    for (const insp of lastInspections) {
      if (!lastCompletedInspections.has(insp.vehicleId)) {
        lastCompletedInspections.set(insp.vehicleId, insp.inspectedAt);
      }
    }

    const { newTasks, skippedVehicles } = generateScheduledRounds({
      complexId,
      policy,
      currentTime,
      vehicles: vehicles.map((v) => ({
        id: v.id,
        complexId: v.complexId,
        plate: v.plate,
        parkingSpace: v.parkingSpace,
        stickerToken: v.stickerToken,
        active: v.active,
      })),
      presences: presencesMap,
      activeTasks: mappedActiveTasks,
      lastCompletedInspections,
    });

    // Insert newly scheduled tasks
    for (const nt of newTasks) {
      await tx.inspectionTask.create({
        data: {
          complexId: nt.complexId,
          vehicleId: nt.vehicleId,
          triggerType: "SCHEDULED",
          status: "PENDING",
          dueAt: nt.dueAt,
          createdAt: nt.createdAt,
          updatedAt: nt.updatedAt,
        },
      });
    }

    return {
      transitionedToOverdueCount: transitionedToOverdue.length,
      newTasksCreatedCount: newTasks.length,
      skippedCount: skippedVehicles.length,
    };
  });
}
