import { NextRequest, NextResponse } from "next/server";
import { getSessionFromRequest } from "@/domain/auth";
import { prisma } from "@/domain/serverScheduler";
import { prioritizeWorkQueue } from "@/domain/queueService";
import { ComplexPolicy } from "@/domain/types";

export async function GET(req: NextRequest) {
  try {
    const session = getSessionFromRequest(req);
    if (!session) {
      return NextResponse.json({ error: "No autenticado" }, { status: 401 });
    }

    const { complexId } = session;

    const complex = await prisma.residentialComplex.findUniqueOrThrow({
      where: { id: complexId },
    });

    const policy: ComplexPolicy = {
      inspectionIntervalMinutes: complex.inspectionIntervalMinutes,
      overdueGraceMinutes: complex.overdueGraceMinutes,
      returnSatisfiesScheduledPolicy: complex.returnSatisfiesScheduledPolicy as any,
      returnWindowMinutes: complex.returnWindowMinutes,
      departureWithPendingTaskPolicy: complex.departureWithPendingTaskPolicy as any,
      queueAlertOrderPolicy: complex.queueAlertOrderPolicy as any,
      overdueEscalationMinutes: complex.overdueEscalationMinutes,
      movementDedupSeconds: complex.movementDedupSeconds,
      retentionDaysPhotos: complex.retentionDaysPhotos,
      retentionDaysRecords: complex.retentionDaysRecords,
    };

    // 1. Fetch active tasks
    const tasks = await prisma.inspectionTask.findMany({
      where: {
        complexId,
        status: { in: ["PENDING", "OVERDUE", "UNABLE_TO_COMPLETE"] },
      },
      include: {
        vehicle: true,
      },
      orderBy: { dueAt: "asc" },
    });

    // 2. Fetch vehicles & presences
    const vehicles = await prisma.vehicle.findMany({
      where: { complexId, active: true },
      include: { presence: true },
    });

    const vehiclesMap = new Map();
    const presencesMap = new Map();

    for (const v of vehicles) {
      vehiclesMap.set(v.id, {
        id: v.id,
        complexId: v.complexId,
        plate: v.plate,
        parkingSpace: v.parkingSpace,
        stickerToken: v.stickerToken,
        active: v.active,
      });

      if (v.presence) {
        presencesMap.set(v.id, {
          vehicleId: v.id,
          currentStatus: v.presence.currentStatus,
          verificationDetails: v.presence.verificationDetails,
          statusUpdatedAt: v.presence.statusUpdatedAt,
        });
      }
    }

    const mappedTasks = tasks.map((t) => ({
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

    const result = prioritizeWorkQueue(mappedTasks, vehiclesMap, presencesMap, policy);

    return NextResponse.json({
      success: true,
      items: result.items,
      uncertainAlerts: result.uncertainAlerts,
      totalCounts: result.totalCounts,
    });
  } catch (err: any) {
    return NextResponse.json(
      { error: err.message || "Error al cargar la cola de inspección" },
      { status: 500 }
    );
  }
}
