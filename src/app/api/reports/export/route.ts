import { NextRequest, NextResponse } from "next/server";
import { getSessionFromRequest } from "@/domain/auth";
import { prisma } from "@/domain/serverScheduler";

export async function GET(req: NextRequest) {
  try {
    const session = getSessionFromRequest(req);
    if (!session) {
      return NextResponse.json({ error: "No autenticado" }, { status: 401 });
    }

    // Role check: Only supervisors and administrators can export records
    if (session.role !== "SUPERVISOR" && session.role !== "RESIDENTIAL_ADMIN" && session.role !== "PLATFORM_ADMIN") {
      return NextResponse.json(
        { error: "Permisos insuficientes para exportar registros" },
        { status: 403 }
      );
    }

    const { searchParams } = new URL(req.url);
    const type = searchParams.get("type") || "inspections"; // 'inspections' | 'movements' | 'incidents'

    if (type === "inspections") {
      const records = await prisma.inspectionRecord.findMany({
        where: { complexId: session.complexId },
        include: {
          vehicle: true,
          task: true,
          inspectedBy: { select: { name: true, email: true } },
        },
        orderBy: { inspectedAt: "desc" },
      });

      // CSV Generation
      const headers = [
        "ID_Registro",
        "Fecha_Hora",
        "Placa",
        "Parqueadero",
        "Tipo_Disparador",
        "Estado_Tarea",
        "Fue_Tardia",
        "Resultado",
        "Inspector",
        "Observaciones",
      ];

      const rows = records.map((r) => [
        r.id,
        r.inspectedAt.toISOString(),
        r.vehicle.plate,
        `"${r.vehicle.parkingSpace || "N/A"}"`,
        r.task.triggerType,
        r.task.status,
        r.task.isLate ? "SI" : "NO",
        r.result,
        `"${r.inspectedBy.name}"`,
        `"${(r.description || "").replace(/"/g, '""')}"`,
      ]);

      const csvContent = [headers.join(","), ...rows.map((row) => row.join(","))].join("\n");

      return new NextResponse(csvContent, {
        headers: {
          "Content-Type": "text/csv; charset=utf-8",
          "Content-Disposition": `attachment; filename="inspecciones_${session.complexId}_${Date.now()}.csv"`,
        },
      });
    } else if (type === "movements") {
      const records = await prisma.vehicleMovementEvent.findMany({
        where: { complexId: session.complexId },
        include: {
          vehicle: true,
          recordedBy: { select: { name: true } },
        },
        orderBy: { recordedAt: "desc" },
      });

      const headers = ["ID_Evento", "Fecha_Hora", "Placa", "Tipo_Movimiento", "Origen", "Guarda_Porteria", "Notas"];
      const rows = records.map((r) => [
        r.id,
        r.recordedAt.toISOString(),
        r.vehicle.plate,
        r.eventType,
        r.source,
        `"${r.recordedBy?.name || "Sistema"}"`,
        `"${(r.notes || "").replace(/"/g, '""')}"`,
      ]);

      const csvContent = [headers.join(","), ...rows.map((row) => row.join(","))].join("\n");

      return new NextResponse(csvContent, {
        headers: {
          "Content-Type": "text/csv; charset=utf-8",
          "Content-Disposition": `attachment; filename="movimientos_${session.complexId}_${Date.now()}.csv"`,
        },
      });
    }

    return NextResponse.json({ error: "Tipo de reporte no válido" }, { status: 400 });
  } catch (err: any) {
    return NextResponse.json(
      { error: err.message || "Error al exportar reporte" },
      { status: 500 }
    );
  }
}
