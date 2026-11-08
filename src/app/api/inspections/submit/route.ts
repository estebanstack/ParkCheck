import { NextRequest, NextResponse } from "next/server";
import { getSessionFromRequest, hasPermission, validateCsrfOrigin } from "@/domain/auth";
import { prisma } from "@/domain/serverScheduler";
import { submitTaskResult } from "@/domain/schedulingEngine";
import { createDamageIncident } from "@/domain/incidentService";

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

    if (!hasPermission(session.role, "canPerformInspections")) {
      return NextResponse.json(
        {
          error: `Acceso denegado: el rol '${session.role}' no tiene permisos para realizar inspecciones.`,
        },
        { status: 403 }
      );
    }

    const {
      taskId,
      result, // NO_VISIBLE_INCIDENT | DAMAGE_OBSERVED | UNABLE_TO_COMPLETE
      description,
      unableToCompleteReason,
      surveillanceRequired = false,
      ownerContactRequired = false,
    } = await req.json();

    if (!taskId || !result) {
      return NextResponse.json(
        { error: "taskId y result requeridos" },
        { status: 400 }
      );
    }

    const now = new Date();

    return await prisma.$transaction(async (tx) => {
      // 1. Fetch task
      const task = await tx.inspectionTask.findUniqueOrThrow({
        where: { id: taskId },
        include: { vehicle: true },
      });

      if (task.complexId !== session.complexId) {
        return NextResponse.json(
          { error: "No autorizado para este conjunto residencial" },
          { status: 403 }
        );
      }

      if (task.status === "COMPLETED") {
        return NextResponse.json(
          {
            error: "La tarea de inspección ya ha sido completada previamente.",
            alreadyCompleted: true,
          },
          { status: 409 }
        );
      }

      // 2. Evaluate completion via domain logic
      const mappedTask = {
        id: task.id,
        complexId: task.complexId,
        vehicleId: task.vehicleId,
        triggerType: task.triggerType as any,
        status: task.status as any,
        dueAt: task.dueAt,
        completedAt: task.completedAt,
        isLate: task.isLate,
        createdAt: task.createdAt,
        updatedAt: task.updatedAt,
      };

      const updatedTaskState = submitTaskResult(
        mappedTask,
        now,
        result === "UNABLE_TO_COMPLETE" ? "UNABLE_TO_COMPLETE" : "COMPLETED",
        unableToCompleteReason
      );

      // Save updated task
      await tx.inspectionTask.update({
        where: { id: taskId },
        data: {
          status: updatedTaskState.status,
          completedAt: updatedTaskState.completedAt,
          isLate: updatedTaskState.isLate,
          unableToCompleteReason: updatedTaskState.unableToCompleteReason,
          updatedAt: now,
        },
      });

      // 3. Create Inspection Record (audit log of observation)
      const inspectionRecord = await tx.inspectionRecord.create({
        data: {
          complexId: session.complexId,
          vehicleId: task.vehicleId,
          taskId: task.id,
          inspectedAt: now,
          inspectedById: session.userId,
          result,
          description: description || null,
        },
      });

      let incidentCreated = null;

      // 4. If damage observed, trigger damage incident workflow
      if (result === "DAMAGE_OBSERVED") {
        const incidentData = createDamageIncident({
          complexId: session.complexId,
          vehicleId: task.vehicleId,
          inspectionRecordId: inspectionRecord.id,
          reportedById: session.userId,
          observedAt: now,
          description: description || "Daño observado durante ronda de inspección",
          surveillanceRequired,
          ownerContactRequired,
        });

        const createdIncident = await tx.incident.create({
          data: {
            id: incidentData.id,
            complexId: incidentData.complexId,
            vehicleId: incidentData.vehicleId,
            inspectionRecordId: incidentData.inspectionRecordId,
            reportedById: incidentData.reportedById,
            observedAt: incidentData.observedAt,
            description: incidentData.description,
            status: incidentData.status,
            surveillanceRequired: incidentData.surveillanceRequired,
            ownerContactRequired: incidentData.ownerContactRequired,
          },
        });

        // Add initial follow-up audit entry
        await tx.incidentFollowUp.create({
          data: {
            incidentId: createdIncident.id,
            actionType: "NOTE",
            description: `Incidente registrado por guarda: ${incidentData.description}`,
            performedById: session.userId,
            performedAt: now,
          },
        });

        // Notify supervisor
        await tx.notification.create({
          data: {
            complexId: session.complexId,
            targetRole: "SUPERVISOR",
            type: "DAMAGE_REPORTED",
            title: "Nuevo Daño Observado",
            message: `Vehículo ${task.vehicle.plate}: ${incidentData.description}`,
            entityType: "INCIDENT",
            entityId: createdIncident.id,
          },
        });

        // If owner contact required, notify entrance gate guard
        if (ownerContactRequired) {
          await tx.notification.create({
            data: {
              complexId: session.complexId,
              targetRole: "ENTRANCE_GUARD",
              type: "OWNER_CONTACT_REQUESTED",
              title: "Contactar Propietario por Daño",
              message: `Se requiere contactar al propietario del vehículo ${task.vehicle.plate} al ingreso o salida.`,
              entityType: "INCIDENT",
              entityId: createdIncident.id,
            },
          });
        }

        incidentCreated = createdIncident;
      }

      return NextResponse.json({
        success: true,
        task: updatedTaskState,
        inspectionRecord,
        incident: incidentCreated,
      });
    });
  } catch (err: any) {
    return NextResponse.json(
      { error: err.message || "Error al enviar resultado de inspección" },
      { status: 500 }
    );
  }
}
