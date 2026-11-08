import { NextRequest, NextResponse } from "next/server";
import { getSessionFromRequest } from "@/domain/auth";
import { prisma } from "@/domain/serverScheduler";

export async function GET(req: NextRequest) {
  try {
    const session = getSessionFromRequest(req);
    if (!session) {
      return NextResponse.json(
        { error: "No autenticado. Proporcione Bearer token o cookie de sesión." },
        { status: 401 }
      );
    }

    const { complexId } = session;

    const complex = await prisma.residentialComplex.findUnique({
      where: { id: complexId },
    });

    if (!complex || !complex.active) {
      return NextResponse.json(
        { error: "Conjunto residencial no encontrado o inactivo" },
        { status: 404 }
      );
    }

    // Fetch active vehicles with presences and active task counts
    const vehicles = await prisma.vehicle.findMany({
      where: { complexId, active: true },
      include: {
        presence: true,
        tasks: {
          where: { status: { in: ["PENDING", "OVERDUE"] } },
          select: { id: true, triggerType: true, status: true, dueAt: true },
        },
      },
      orderBy: { plate: "asc" },
    });

    const mappedVehicles = vehicles.map((v) => ({
      id: v.id,
      plate: v.plate,
      parkingSpace: v.parkingSpace,
      stickerToken: v.stickerToken,
      presenceStatus: v.presence?.currentStatus || "INSIDE",
      verificationDetails: v.presence?.verificationDetails,
      activeTasks: v.tasks,
    }));

    return NextResponse.json({
      success: true,
      serverTime: new Date().toISOString(),
      complex: {
        id: complex.id,
        name: complex.name,
        code: complex.code,
        address: complex.address,
        city: complex.city,
        policies: {
          inspectionIntervalMinutes: complex.inspectionIntervalMinutes,
          overdueGraceMinutes: complex.overdueGraceMinutes,
          returnSatisfiesScheduledPolicy: complex.returnSatisfiesScheduledPolicy,
          returnWindowMinutes: complex.returnWindowMinutes,
          departureWithPendingTaskPolicy: complex.departureWithPendingTaskPolicy,
          movementDedupSeconds: complex.movementDedupSeconds,
        },
      },
      vehicles: mappedVehicles,
    });
  } catch (err: any) {
    return NextResponse.json(
      { error: err.message || "Error al sincronizar manifiesto" },
      { status: 500 }
    );
  }
}
