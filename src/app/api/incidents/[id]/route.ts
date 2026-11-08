import { NextRequest, NextResponse } from "next/server";
import { getSessionFromRequest } from "@/domain/auth";
import { prisma } from "@/domain/serverScheduler";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = getSessionFromRequest(req);
    if (!session) {
      return NextResponse.json({ error: "No autenticado" }, { status: 401 });
    }

    const { id } = await params;
    if (!id) {
      return NextResponse.json({ error: "ID de incidente requerido" }, { status: 400 });
    }

    const incident = await prisma.incident.findUnique({
      where: { id },
      include: {
        vehicle: true,
        reportedBy: { select: { id: true, name: true, email: true } },
        followUps: {
          include: { performedBy: { select: { id: true, name: true } } },
          orderBy: { performedAt: "desc" },
        },
        attachments: true,
      },
    });

    if (!incident) {
      return NextResponse.json({ error: "Incidente no encontrado" }, { status: 404 });
    }

    if (incident.complexId !== session.complexId) {
      return NextResponse.json(
        { error: "No autorizado: el incidente no pertenece a su conjunto residencial asignado" },
        { status: 403 }
      );
    }

    return NextResponse.json({ success: true, incident });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Error al obtener incidente";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
