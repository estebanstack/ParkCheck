import { NextRequest, NextResponse } from "next/server";
import { getSessionFromRequest, verifySchedulerSecret } from "@/domain/auth";
import { executeComplexSchedulingTick } from "@/domain/serverScheduler";

export async function POST(req: NextRequest) {
  try {
    const authHeader = req.headers.get("authorization");
    const isCron = verifySchedulerSecret(authHeader);
    const session = getSessionFromRequest(req);

    if (!session && !isCron) {
      return NextResponse.json({ error: "No autorizado" }, { status: 401 });
    }

    if (session) {
      const allowedRoles = ["SUPERVISOR", "RESIDENTIAL_ADMIN", "PLATFORM_ADMIN"];
      if (!allowedRoles.includes(session.role)) {
        return NextResponse.json(
          { error: "Acceso denegado: permisos insuficientes para ejecutar el programador" },
          { status: 403 }
        );
      }
    }

    const body = await req.json().catch(() => ({}));
    let complexId = body.complexId;

    if (!complexId && session) {
      complexId = session.complexId;
    }

    if (session && session.role !== "PLATFORM_ADMIN") {
      if (body.complexId && body.complexId !== session.complexId) {
        return NextResponse.json(
          { error: "Acceso denegado: no autorizado para ejecutar programación en este conjunto" },
          { status: 403 }
        );
      }
    }

    if (!complexId) {
      return NextResponse.json({ error: "complexId requerido" }, { status: 400 });
    }

    const result = await executeComplexSchedulingTick(complexId, new Date());

    return NextResponse.json({ success: true, result });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Error al ejecutar el ciclo de programación";
    return NextResponse.json(
      { error: message },
      { status: 500 }
    );
  }
}
