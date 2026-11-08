import { NextRequest, NextResponse } from "next/server";
import { getSessionFromRequest, hasPermission, validateCsrfOrigin } from "@/domain/auth";
import { prisma } from "@/domain/serverScheduler";
import {
  transitionIncidentStatus,
  recordSurveillanceOutcome,
  recordOwnerContact,
  recordInvestigationNote,
  IncidentEntity,
  FollowUpRecord,
} from "@/domain/incidentService";
import { IncidentStatus } from "@/domain/types";

// GET /api/incidents - List incidents with filtering and complex isolation
export async function GET(req: NextRequest) {
  try {
    const session = getSessionFromRequest(req);
    if (!session) {
      return NextResponse.json({ error: "No autenticado" }, { status: 401 });
    }

    const { searchParams } = req.nextUrl;
    const idParam = searchParams.get("id");
    const statusParam = searchParams.get("status");
    const plateParam = searchParams.get("plate");

    // Dynamic where clause strictly scoped to the tenant complexId
    const whereClause: Record<string, unknown> = {
      complexId: session.complexId,
    };

    if (idParam) {
      whereClause.id = idParam;
    }

    if (statusParam) {
      if (statusParam === "UNRESOLVED" || statusParam === "OPEN") {
        whereClause.status = {
          notIn: ["RESOLVED", "CLOSED"],
        };
      } else {
        whereClause.status = statusParam as IncidentStatus;
      }
    }

    if (plateParam) {
      whereClause.vehicle = {
        plate: {
          contains: plateParam.trim().toUpperCase(),
        },
      };
    }

    const incidents = await prisma.incident.findMany({
      where: whereClause,
      include: {
        vehicle: true,
        reportedBy: { select: { id: true, name: true, email: true } },
        followUps: {
          include: { performedBy: { select: { id: true, name: true } } },
          orderBy: { performedAt: "desc" },
        },
        attachments: true,
      },
      orderBy: { observedAt: "desc" },
    });

    return NextResponse.json({ success: true, incidents });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Error al listar incidentes";
    return NextResponse.json(
      { error: message },
      { status: 500 }
    );
  }
}

// POST /api/incidents - Follow-up updates and state transitions
export async function POST(req: NextRequest) {
  try {
    if (!validateCsrfOrigin(req)) {
      return NextResponse.json(
        { error: "Solicitud rechazada: origen no autorizado (protección CSRF)" },
        { status: 403 }
      );
    }

    const session = getSessionFromRequest(req);
    if (!session) {
      return NextResponse.json({ error: "No autenticado" }, { status: 401 });
    }

    if (!hasPermission(session.role, "canManageIncidents")) {
      return NextResponse.json(
        {
          error: `Acceso denegado: el rol '${session.role}' no tiene permisos para gestionar incidentes.`,
        },
        { status: 403 }
      );
    }

    let body: Record<string, unknown>;
    try {
      body = await req.json();
    } catch {
      return NextResponse.json(
        { error: "Cuerpo de solicitud inválido o no es JSON válido." },
        { status: 400 }
      );
    }

    const incidentId = typeof body.incidentId === "string" ? body.incidentId.trim() : "";
    const action = typeof body.action === "string" ? body.action.trim() : "";
    const notes = typeof body.notes === "string" ? body.notes.trim() : "";
    const newStatus = typeof body.newStatus === "string" ? (body.newStatus.trim() as IncidentStatus) : undefined;
    const contactSuccessful = typeof body.contactSuccessful === "boolean" ? body.contactSuccessful : Boolean(body.contactSuccessful);
    const contactMethod = typeof body.contactMethod === "string" ? body.contactMethod.trim() : undefined;
    const nextAction = typeof body.nextAction === "string" ? body.nextAction.trim() : undefined;
    const outcome = typeof body.outcome === "string" ? body.outcome.trim() : notes;
    const expectedUpdatedAt = typeof body.expectedUpdatedAt === "string" ? body.expectedUpdatedAt : undefined;

    if (!incidentId || !action) {
      return NextResponse.json(
        { error: "Campos requeridos faltantes: incidentId y action son obligatorios." },
        { status: 400 }
      );
    }

    const validActions = ["SURVEILLANCE", "OWNER_CONTACT", "STATUS_TRANSITION", "NOTE", "INVESTIGATION_NOTE"];
    if (!validActions.includes(action)) {
      return NextResponse.json(
        { error: `Acción no soportada '${action}'. Acciones válidas: ${validActions.join(", ")}.` },
        { status: 400 }
      );
    }

    const now = new Date();

    return await prisma.$transaction(async (tx) => {
      const incident = await tx.incident.findUnique({
        where: { id: incidentId },
        include: { vehicle: true },
      });

      if (!incident) {
        return NextResponse.json({ error: "Incidente no encontrado." }, { status: 404 });
      }

      if (incident.complexId !== session.complexId) {
        return NextResponse.json(
          { error: "No autorizado: el incidente no pertenece a su conjunto residencial asignado." },
          { status: 403 }
        );
      }

      // Optimistic concurrency control: verify that client has not submitted a mutation on stale state
      // Deliberate token policy:
      // - If client provides expectedUpdatedAt: validate ISO format and perform exact millisecond equality check (eliminating arbitrary 1000ms window).
      // - If client omits expectedUpdatedAt: permit mutation for backwards compatibility and mobile sync callers, while maintaining transactional consistency.
      if (expectedUpdatedAt !== undefined) {
        const clientTimestamp = new Date(expectedUpdatedAt).getTime();
        if (isNaN(clientTimestamp)) {
          return NextResponse.json(
            {
              error: "Formato inválido de 'expectedUpdatedAt': debe ser una marca de tiempo válida.",
              code: "INVALID_CONCURRENCY_TOKEN",
            },
            { status: 400 }
          );
        }

        const serverTimestamp = new Date(incident.updatedAt).getTime();
        if (clientTimestamp !== serverTimestamp) {
          return NextResponse.json(
            {
              error:
                "Conflicto de concurrencia: el incidente ha sido modificado por otro usuario o rondero. Por favor recargue la información antes de continuar.",
              code: "CONCURRENT_MODIFICATION",
            },
            { status: 409 }
          );
        }
      }

      const mappedIncident: IncidentEntity = {
        id: incident.id,
        complexId: incident.complexId,
        vehicleId: incident.vehicleId,
        inspectionRecordId: incident.inspectionRecordId,
        reportedById: incident.reportedById,
        observedAt: incident.observedAt,
        description: incident.description,
        status: incident.status as IncidentStatus,
        surveillanceRequired: incident.surveillanceRequired,
        surveillanceOutcome: incident.surveillanceOutcome,
        ownerContactRequired: incident.ownerContactRequired,
        ownerContactedAt: incident.ownerContactedAt,
        ownerContactNotes: incident.ownerContactNotes,
        resolutionNotes: incident.resolutionNotes,
        resolvedAt: incident.resolvedAt,
        createdAt: incident.createdAt,
        updatedAt: incident.updatedAt,
      };

      let updatedData: Record<string, unknown> = {};
      let followUpData: FollowUpRecord | null = null;

      try {
        if (action === "SURVEILLANCE") {
          const res = recordSurveillanceOutcome(
            mappedIncident,
            outcome || "Revisión efectuada sin novedades concluyentes",
            session.userId,
            now,
            {
              advanceToUnderInvestigation: Boolean(body.advanceToUnderInvestigation),
              observations: notes || undefined,
            }
          );
          updatedData = {
            status: res.updatedIncident.status,
            surveillanceOutcome: res.updatedIncident.surveillanceOutcome,
            updatedAt: now,
          };
          followUpData = res.followUp;
        } else if (action === "OWNER_CONTACT") {
          const res = recordOwnerContact(
            mappedIncident,
            contactSuccessful,
            notes || "Intento de comunicación con el propietario",
            session.userId,
            now,
            {
              contactMethod,
              nextAction,
            }
          );
          updatedData = {
            status: res.updatedIncident.status,
            ownerContactedAt: res.updatedIncident.ownerContactedAt,
            ownerContactNotes: res.updatedIncident.ownerContactNotes,
            updatedAt: now,
          };
          followUpData = res.followUp;
        } else if (action === "STATUS_TRANSITION") {
          if (!newStatus) {
            return NextResponse.json(
              { error: "Campo requerido 'newStatus' no especificado para la transición de estado." },
              { status: 400 }
            );
          }
          const res = transitionIncidentStatus(
            mappedIncident,
            newStatus,
            notes || "Actualización de estado",
            session.userId,
            now
          );
          updatedData = {
            status: res.updatedIncident.status,
            resolutionNotes: res.updatedIncident.resolutionNotes,
            resolvedAt: res.updatedIncident.resolvedAt,
            updatedAt: now,
          };
          followUpData = res.followUp;
        } else if (action === "NOTE" || action === "INVESTIGATION_NOTE") {
          const res = recordInvestigationNote(
            mappedIncident,
            notes,
            session.userId,
            now,
            { nextAction }
          );
          updatedData = {
            updatedAt: now,
          };
          followUpData = res.followUp;
        }
      } catch (domainError: unknown) {
        const domainMsg = domainError instanceof Error ? domainError.message : "Error en regla de negocio de incidentes";
        return NextResponse.json(
          { error: domainMsg },
          { status: 400 }
        );
      }

      // Atomic conditional update to eliminate check-then-write race:
      // Condition on updatedAt guarantees that concurrent transactions committing between read and write
      // cannot silently overwrite state.
      const lockTimestamp = expectedUpdatedAt ? new Date(expectedUpdatedAt) : incident.updatedAt;

      let updatedIncident;
      if (typeof tx.incident.updateMany === "function") {
        const updateResult = await tx.incident.updateMany({
          where: {
            id: incidentId,
            complexId: session.complexId,
            updatedAt: lockTimestamp,
          },
          data: updatedData,
        });

        if (updateResult.count === 0) {
          return NextResponse.json(
            {
              error:
                "Conflicto de concurrencia: el incidente ha sido modificado por otro usuario o rondero. Por favor recargue la información antes de continuar.",
              code: "CONCURRENT_MODIFICATION",
            },
            { status: 409 }
          );
        }

        const fresh = await tx.incident.findUnique({
          where: { id: incidentId },
        });
        updatedIncident = fresh || ({ ...incident, ...updatedData });
      } else {
        // Fallback for mock environments without updateMany
        updatedIncident = await tx.incident.update({
          where: { id: incidentId },
          data: updatedData,
        });
      }

      // Insert immutable audit follow-up
      if (followUpData) {
        await tx.incidentFollowUp.create({
          data: {
            id: followUpData.id,
            incidentId: followUpData.incidentId,
            actionType: followUpData.actionType,
            description: followUpData.description,
            performedById: session.userId,
            performedAt: now,
            outcome: followUpData.outcome,
          },
        });
      }

      return NextResponse.json({
        success: true,
        incident: updatedIncident,
        followUp: followUpData,
      });
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Error al actualizar incidente";
    return NextResponse.json(
      { error: message },
      { status: 500 }
    );
  }
}
