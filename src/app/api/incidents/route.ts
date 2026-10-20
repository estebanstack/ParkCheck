import { NextRequest, NextResponse } from "next/server";
import { getSessionFromRequest } from "@/domain/auth";
import { prisma } from "@/domain/serverScheduler";
import {
  transitionIncidentStatus,
  recordSurveillanceOutcome,
  recordOwnerContact,
} from "@/domain/incidentService";

// GET /api/incidents - List incidents with filtering
export async function GET(req: NextRequest) {
  try {
    const session = getSessionFromRequest(req);
    if (!session) {
      return NextResponse.json({ error: "No autenticado" }, { status: 401 });
    }

    const incidents = await prisma.incident.findMany({
      where: { complexId: session.complexId },
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
  } catch (err: any) {
    return NextResponse.json(
      { error: err.message || "Error al listar incidentes" },
      { status: 500 }
    );
  }
}

// POST /api/incidents - Follow-up updates (CCTV, owner contact, status change)
export async function POST(req: NextRequest) {
  try {
    const session = getSessionFromRequest(req);
    if (!session) {
      return NextResponse.json({ error: "No autenticado" }, { status: 401 });
    }

    const {
      incidentId,
      action, // 'SURVEILLANCE' | 'OWNER_CONTACT' | 'STATUS_TRANSITION'
      notes,
      newStatus,
      contactSuccessful,
    } = await req.json();

    if (!incidentId || !action) {
      return NextResponse.json(
        { error: "incidentId y action requeridos" },
        { status: 400 }
      );
    }

    const now = new Date();

    return await prisma.$transaction(async (tx) => {
      const incident = await tx.incident.findUniqueOrThrow({
        where: { id: incidentId },
        include: { vehicle: true },
      });

      if (incident.complexId !== session.complexId) {
        return NextResponse.json({ error: "No autorizado" }, { status: 403 });
      }

      const mappedIncident = {
        id: incident.id,
        complexId: incident.complexId,
        vehicleId: incident.vehicleId,
        reportedById: incident.reportedById,
        observedAt: incident.observedAt,
        description: incident.description,
        status: incident.status as any,
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

      let updatedData = {};
      let followUpData: any = null;

      if (action === "SURVEILLANCE") {
        const res = recordSurveillanceOutcome(
          mappedIncident,
          notes || "Revisión efectuada sin novedades concluyentes",
          session.userId,
          now
        );
        updatedData = {
          surveillanceOutcome: res.updatedIncident.surveillanceOutcome,
          updatedAt: now,
        };
        followUpData = res.followUp;
      } else if (action === "OWNER_CONTACT") {
        const res = recordOwnerContact(
          mappedIncident,
          !!contactSuccessful,
          notes || "Intento de comunicación con el propietario",
          session.userId,
          now
        );
        updatedData = {
          status: res.updatedIncident.status,
          ownerContactedAt: res.updatedIncident.ownerContactedAt,
          ownerContactNotes: res.updatedIncident.ownerContactNotes,
          updatedAt: now,
        };
        followUpData = res.followUp;
      } else if (action === "STATUS_TRANSITION") {
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
      }

      // Update incident
      const updatedIncident = await tx.incident.update({
        where: { id: incidentId },
        data: updatedData,
      });

      // Insert follow-up record
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
  } catch (err: any) {
    return NextResponse.json(
      { error: err.message || "Error al actualizar incidente" },
      { status: 500 }
    );
  }
}
