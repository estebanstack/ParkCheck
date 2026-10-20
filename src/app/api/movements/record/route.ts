import { NextRequest, NextResponse } from "next/server";
import { getSessionFromRequest } from "@/domain/auth";
import { prisma } from "@/domain/serverScheduler";
import {
  derivePresenceFromMovement,
  isDuplicateMovement,
  buildReturnInspectionTask,
  handleVehicleDeparture,
} from "@/domain/movementStateMachine";
import { ComplexPolicy } from "@/domain/types";

export async function POST(req: NextRequest) {
  try {
    const session = getSessionFromRequest(req);
    if (!session) {
      return NextResponse.json({ error: "No autenticado" }, { status: 401 });
    }

    const { plate, eventType, source = "GATE_MANUAL", notes } = await req.json();

    if (!plate || !eventType || (eventType !== "ARRIVAL" && eventType !== "DEPARTURE")) {
      return NextResponse.json(
        { error: "Placa y tipo de movimiento válido (ARRIVAL o DEPARTURE) requeridos" },
        { status: 400 }
      );
    }

    const normalizedPlate = plate.trim().toUpperCase();
    const now = new Date();

    return await prisma.$transaction(async (tx) => {
      // 1. Find or create vehicle in this complex
      let vehicle = await tx.vehicle.findUnique({
        where: {
          complexId_plate: {
            complexId: session.complexId,
            plate: normalizedPlate,
          },
        },
        include: { presence: true },
      });

      if (!vehicle) {
        // Auto-register visitor / new vehicle
        vehicle = await tx.vehicle.create({
          data: {
            complexId: session.complexId,
            plate: normalizedPlate,
          },
          include: { presence: true },
        });

        // Initialize presence
        await tx.vehiclePresence.create({
          data: {
            vehicleId: vehicle.id,
            currentStatus: eventType === "ARRIVAL" ? "INSIDE" : "AWAY",
          },
        });
      }

      // 2. Fetch complex policy for duplicate cooldown and return window
      const complex = await tx.residentialComplex.findUniqueOrThrow({
        where: { id: session.complexId },
      });

      const policy: ComplexPolicy = {
        inspectionIntervalMinutes: complex.inspectionIntervalMinutes,
        overdueGraceMinutes: complex.overdueGraceMinutes,
        returnSatisfiesScheduledPolicy: complex.returnSatisfiesScheduledPolicy as any,
        returnWindowMinutes: complex.returnWindowMinutes,
        departureWithPendingTaskPolicy: complex.departureWithPendingTaskPolicy as any,
        queueAlertOrderPolicy: complex.queueAlertOrderPolicy as any,
        overdueEscalationMinutes: complex.overdueEscalationMinutes,
        movementDedupSeconds: complex.movementDedupSeconds,
        retentionDaysPhotos: complex.retentionDaysPhotos,
        retentionDaysRecords: complex.retentionDaysRecords,
      };

      // 3. Duplicate check within cooldown window
      const lastMovement = await tx.vehicleMovementEvent.findFirst({
        where: { complexId: session.complexId, vehicleId: vehicle.id },
        orderBy: { recordedAt: "desc" },
      });

      if (
        lastMovement &&
        isDuplicateMovement(
          {
            id: lastMovement.id,
            complexId: lastMovement.complexId,
            vehicleId: lastMovement.vehicleId,
            eventType: lastMovement.eventType as any,
            recordedAt: lastMovement.recordedAt,
            source: lastMovement.source,
          },
          eventType,
          now,
          policy.movementDedupSeconds
        )
      ) {
        return NextResponse.json(
          {
            error: `Movimiento duplicado ignorado. Se registró un evento de ${eventType} hace menos de ${policy.movementDedupSeconds} segundos.`,
            duplicate: true,
          },
          { status: 409 }
        );
      }

      // 4. Record append-only movement event
      const movement = await tx.vehicleMovementEvent.create({
        data: {
          complexId: session.complexId,
          vehicleId: vehicle.id,
          eventType,
          recordedAt: now,
          recordedById: session.userId,
          source,
          notes,
        },
      });

      // 5. Update vehicle presence and manage tasks
      const currentPresence = vehicle.presence?.currentStatus || "AWAY";
      const newPresence = derivePresenceFromMovement(currentPresence as any, eventType);

      await tx.vehiclePresence.upsert({
        where: { vehicleId: vehicle.id },
        update: {
          currentStatus: newPresence,
          lastMovementEventId: movement.id,
          statusUpdatedAt: now,
        },
        create: {
          vehicleId: vehicle.id,
          currentStatus: newPresence,
          lastMovementEventId: movement.id,
          statusUpdatedAt: now,
        },
      });

      let returnTaskCreated = false;
      let reviewNotice: string | undefined;

      if (eventType === "ARRIVAL") {
        // Build return inspection obligation
        const returnTask = buildReturnInspectionTask(
          session.complexId,
          vehicle.id,
          movement.id,
          now,
          policy
        );

        await tx.inspectionTask.create({
          data: {
            id: returnTask.id,
            complexId: returnTask.complexId,
            vehicleId: returnTask.vehicleId,
            triggerType: "RETURN",
            status: "PENDING",
            dueAt: returnTask.dueAt,
            relatedMovementId: movement.id,
            createdAt: now,
            updatedAt: now,
          },
        });

        returnTaskCreated = true;

        // Broadcast in-app notification to ronderos
        await tx.notification.create({
          data: {
            complexId: session.complexId,
            targetRole: "PARKING_GUARD",
            type: "RETURN_INSPECTION_CREATED",
            title: "Nuevo Retorno de Vehículo",
            message: `El vehículo ${vehicle.plate} ha ingresado. Inspección de retorno requerida.`,
            entityType: "TASK",
            entityId: returnTask.id,
          },
        });
      } else if (eventType === "DEPARTURE") {
        // Vehicle leaves: Preserve all outstanding tasks!
        const existingTasks = await tx.inspectionTask.findMany({
          where: {
            vehicleId: vehicle.id,
            status: { in: ["PENDING", "OVERDUE"] },
          },
        });

        const mappedTasks = existingTasks.map((t) => ({
          id: t.id,
          complexId: t.complexId,
          vehicleId: t.vehicleId,
          triggerType: t.triggerType as any,
          status: t.status as any,
          dueAt: t.dueAt,
          isLate: t.isLate,
          createdAt: t.createdAt,
          updatedAt: t.updatedAt,
        }));

        const departureResult = handleVehicleDeparture(
          mappedTasks,
          {
            id: movement.id,
            complexId: movement.complexId,
            vehicleId: movement.vehicleId,
            eventType: "DEPARTURE",
            recordedAt: now,
            source,
          },
          policy
        );

        reviewNotice = departureResult.reviewNotice;
      }

      return NextResponse.json({
        success: true,
        movement: {
          id: movement.id,
          plate: vehicle.plate,
          eventType,
          recordedAt: movement.recordedAt,
          presence: newPresence,
        },
        returnTaskCreated,
        reviewNotice,
      });
    });
  } catch (err: any) {
    return NextResponse.json(
      { error: err.message || "Error al registrar movimiento" },
      { status: 500 }
    );
  }
}
