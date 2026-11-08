import { NextRequest, NextResponse } from "next/server";
import { getSessionFromRequest } from "@/domain/auth";
import { prisma } from "@/domain/serverScheduler";
import { processSyncBatch } from "@/domain/syncService";
import { SyncBatchRequest } from "@/domain/syncTypes";

export async function POST(req: NextRequest) {
  try {
    const session = getSessionFromRequest(req);
    if (!session) {
      return NextResponse.json(
        { error: "No autenticado. Proporcione Bearer token o cookie de sesión válido." },
        { status: 401 }
      );
    }

    const body = (await req.json()) as SyncBatchRequest;

    if (!body || !body.complexId || !body.clientBatchId || !Array.isArray(body.events)) {
      return NextResponse.json(
        {
          error:
            "Estructura de lote inválida: 'complexId', 'clientBatchId' y arreglo 'events' requeridos.",
        },
        { status: 400 }
      );
    }

    // Role-based / complex scoping validation
    if (session.complexId !== body.complexId) {
      return NextResponse.json(
        {
          error: `Acceso no autorizado: la sesión pertenece al conjunto '${session.complexId}', pero se intentó sincronizar con '${body.complexId}'.`,
        },
        { status: 403 }
      );
    }

    const response = await processSyncBatch(prisma, session, body);

    return NextResponse.json(response, { status: 200 });
  } catch (err: any) {
    return NextResponse.json(
      { error: err.message || "Error interno al procesar lote de sincronización" },
      { status: 500 }
    );
  }
}
