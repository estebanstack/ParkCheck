import { NextRequest, NextResponse } from "next/server";
import { getSessionFromRequest } from "@/domain/auth";
import { prisma } from "@/domain/serverScheduler";

export async function GET(req: NextRequest) {
  try {
    const session = getSessionFromRequest(req);
    if (!session) {
      return NextResponse.json({ error: "No autenticado" }, { status: 401 });
    }

    const { searchParams } = new URL(req.url);
    const plate = searchParams.get("plate");
    const token = searchParams.get("token");

    if (!plate && !token) {
      return NextResponse.json(
        { error: "Placa o token NFC/QR requerido" },
        { status: 400 }
      );
    }

    const vehicle = await prisma.vehicle.findFirst({
      where: {
        complexId: session.complexId,
        ...(token ? { stickerToken: token } : { plate: plate!.trim().toUpperCase() }),
      },
      include: {
        presence: true,
        tasks: {
          where: { status: { in: ["PENDING", "OVERDUE"] } },
          orderBy: { dueAt: "asc" },
        },
        inspections: {
          orderBy: { inspectedAt: "desc" },
          take: 5,
          include: { inspectedBy: { select: { name: true } } },
        },
        movements: {
          orderBy: { recordedAt: "desc" },
          take: 5,
        },
      },
    });

    if (!vehicle) {
      return NextResponse.json(
        { error: "Vehículo no registrado en este conjunto residencial" },
        { status: 404 }
      );
    }

    return NextResponse.json({
      success: true,
      vehicle: {
        id: vehicle.id,
        plate: vehicle.plate,
        parkingSpace: vehicle.parkingSpace,
        stickerToken: vehicle.stickerToken,
        presenceStatus: vehicle.presence?.currentStatus || "INSIDE",
        verificationDetails: vehicle.presence?.verificationDetails,
        activeTasks: vehicle.tasks,
        recentInspections: vehicle.inspections,
        recentMovements: vehicle.movements,
      },
    });
  } catch (err: any) {
    return NextResponse.json(
      { error: err.message || "Error al consultar vehículo" },
      { status: 500 }
    );
  }
}
