import { NextRequest, NextResponse } from "next/server";
import { getSessionFromRequest } from "@/domain/auth";
import { executeComplexSchedulingTick } from "@/domain/serverScheduler";

export async function POST(req: NextRequest) {
  try {
    const session = getSessionFromRequest(req);
    // Allow supervisor, platform admin or cron system token
    const authHeader = req.headers.get("authorization");
    const isCron = authHeader === `Bearer ${process.env.SESSION_SECRET}`;

    if (!session && !isCron) {
      return NextResponse.json({ error: "No autorizado" }, { status: 401 });
    }

    const body = await req.json().catch(() => ({}));
    const complexId = body.complexId || session?.complexId;

    if (!complexId) {
      return NextResponse.json({ error: "complexId requerido" }, { status: 400 });
    }

    const result = await executeComplexSchedulingTick(complexId, new Date());

    return NextResponse.json({ success: true, result });
  } catch (err: any) {
    return NextResponse.json(
      { error: err.message || "Error al ejecutar el ciclo de programación" },
      { status: 500 }
    );
  }
}
