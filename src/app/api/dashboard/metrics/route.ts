import { NextRequest, NextResponse } from "next/server";
import { getSessionFromRequest } from "@/domain/auth";
import { prisma } from "@/domain/serverScheduler";

export async function GET(req: NextRequest) {
  try {
    const session = getSessionFromRequest(req);
    if (!session) {
      return NextResponse.json({ error: "No autenticado" }, { status: 401 });
    }

    const { complexId } = session;

    // Derived counts
    const [insideCount, awayCount, uncertainCount] = await Promise.all([
      prisma.vehiclePresence.count({
        where: {
          vehicle: { complexId },
          currentStatus: "INSIDE",
        },
      }),
      prisma.vehiclePresence.count({
        where: {
          vehicle: { complexId },
          currentStatus: "AWAY",
        },
      }),
      prisma.vehiclePresence.count({
        where: {
          vehicle: { complexId },
          currentStatus: "UNCERTAIN",
        },
      }),
    ]);

    const [pendingReturnCount, pendingScheduledCount, overdueCount, failedCount] =
      await Promise.all([
        prisma.inspectionTask.count({
          where: {
            complexId,
            triggerType: "RETURN",
            status: "PENDING",
          },
        }),
        prisma.inspectionTask.count({
          where: {
            complexId,
            triggerType: "SCHEDULED",
            status: "PENDING",
          },
        }),
        prisma.inspectionTask.count({
          where: {
            complexId,
            status: "OVERDUE",
          },
        }),
        prisma.inspectionTask.count({
          where: {
            complexId,
            status: "UNABLE_TO_COMPLETE",
          },
        }),
      ]);

    const openIncidentsCount = await prisma.incident.count({
      where: {
        complexId,
        status: { notIn: ["RESOLVED", "CLOSED"] },
      },
    });

    const recentNotifications = await prisma.notification.findMany({
      where: {
        complexId,
        OR: [{ recipientId: session.userId }, { targetRole: session.role }, { targetRole: null }],
      },
      orderBy: { createdAt: "desc" },
      take: 5,
    });

    return NextResponse.json({
      metrics: {
        insideCount,
        awayCount,
        uncertainCount,
        pendingReturnCount,
        pendingScheduledCount,
        overdueCount,
        failedCount,
        openIncidentsCount,
      },
      notifications: recentNotifications,
    });
  } catch (err: any) {
    return NextResponse.json(
      { error: err.message || "Error al cargar métricas" },
      { status: 500 }
    );
  }
}
