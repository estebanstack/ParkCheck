// ParkCheck - Synchronization Engine & Idempotent Batch Processor
// Specification Reference: Section 4, 5, 8, 14, 15

import { PrismaClient } from "@prisma/client";
import {
  SyncBatchRequest,
  SyncBatchResponse,
  SyncEventResult,
  AnyClientSyncEvent,
  ClientMovementEvent,
  ClientInspectionEvent,
  ClientIncidentEvent,
  ClientAttachmentEvent,
} from "./syncTypes";
import { SessionPayload, hasPermission } from "./auth";
import { ComplexPolicy, DEFAULT_COMPLEX_POLICY } from "./types";
import {
  derivePresenceFromMovement,
  buildReturnInspectionTask,
  handleVehicleDeparture,
} from "./movementStateMachine";
import { submitTaskResult } from "./schedulingEngine";
import { createDamageIncident } from "./incidentService";
import { saveAttachmentFile } from "./storageDriver";
import path from "path";
import fs from "fs/promises";

export interface SyncProcessorContext {
  tx: any;
  session: SessionPayload;
  policy: ComplexPolicy;
  serverTime: Date;
}

/**
 * Main batch sync entrypoint.
 * Operates within a single transaction to guarantee atomic acknowledgment or deterministic error reporting.
 */
export async function processSyncBatch(
  prisma: PrismaClient,
  session: SessionPayload,
  batch: SyncBatchRequest
): Promise<SyncBatchResponse> {
  const serverTime = new Date();

  // 1. Authorization: Complex level isolation
  if (batch.complexId !== session.complexId) {
    throw new Error(
      `Acceso no autorizado: el conjunto solicitado (${batch.complexId}) no coincide con la sesión autorizada (${session.complexId})`
    );
  }

  return await prisma.$transaction(async (tx) => {
    // Fetch complex policies
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

    const ctx: SyncProcessorContext = {
      tx,
      session,
      policy,
      serverTime,
    };

    const results: SyncEventResult[] = [];

    let acknowledgedCount = 0;
    let duplicateCount = 0;
    let conflictCount = 0;
    let rejectedCount = 0;

    for (const event of batch.events) {
      const result = await processSingleEvent(ctx, event);
      results.push(result);

      if (result.status === "ACKNOWLEDGED") acknowledgedCount++;
      else if (result.status === "DUPLICATE_ACKNOWLEDGED") duplicateCount++;
      else if (result.status === "CONFLICT_FLAGGED") conflictCount++;
      else if (result.status === "REJECTED") rejectedCount++;
    }

    return {
      success: true,
      batchId: batch.clientBatchId,
      complexId: batch.complexId,
      processedAt: serverTime.toISOString(),
      serverTime: serverTime.toISOString(),
      totalEvents: batch.events.length,
      acknowledgedCount,
      duplicateCount,
      conflictCount,
      rejectedCount,
      results,
    };
  });
}

/**
 * Dispatches and processes an individual client event with strict idempotency.
 */
async function processSingleEvent(
  ctx: SyncProcessorContext,
  event: AnyClientSyncEvent
): Promise<SyncEventResult> {
  const { tx, session, serverTime } = ctx;
  const clientRecordedAt = new Date(event.recordedAt || serverTime);

  // 1. Check server-side idempotency log
  const existingLog = await tx.syncEventLog.findUnique({
    where: {
      complexId_clientEventId: {
        complexId: session.complexId,
        clientEventId: event.clientEventId,
      },
    },
  });

  if (existingLog) {
    // Event was previously processed: Return idempotent replay without side effects!
    return {
      clientEventId: event.clientEventId,
      eventType: event.eventType,
      status: "DUPLICATE_ACKNOWLEDGED",
      entityId: existingLog.entityId || undefined,
      conflictReason: existingLog.conflictReason || undefined,
      clientRecordedAt: existingLog.recordedAt.toISOString(),
      serverReceivedAt: existingLog.receivedAt.toISOString(),
    };
  }

  // 2. Dispatch by event type
  let result: SyncEventResult;
  try {
    switch (event.eventType) {
      case "MOVEMENT":
        result = await processMovementEvent(ctx, event, clientRecordedAt);
        break;
      case "INSPECTION":
        result = await processInspectionEvent(ctx, event, clientRecordedAt);
        break;
      case "INCIDENT":
        result = await processIncidentEvent(ctx, event, clientRecordedAt);
        break;
      case "ATTACHMENT":
        result = await processAttachmentEvent(ctx, event, clientRecordedAt);
        break;
      default:
        result = {
          clientEventId: (event as any).clientEventId,
          eventType: (event as any).eventType,
          status: "REJECTED",
          error: `Tipo de evento no soportado: ${(event as any).eventType}`,
          clientRecordedAt: clientRecordedAt.toISOString(),
          serverReceivedAt: serverTime.toISOString(),
        };
    }
  } catch (err: any) {
    result = {
      clientEventId: event.clientEventId,
      eventType: event.eventType,
      status: "REJECTED",
      error: err.message || "Error al procesar evento",
      clientRecordedAt: clientRecordedAt.toISOString(),
      serverReceivedAt: serverTime.toISOString(),
    };
  }

  // 3. Persist record in syncEventLog to enforce future idempotency
  await tx.syncEventLog.create({
    data: {
      complexId: session.complexId,
      clientEventId: event.clientEventId,
      eventType: event.eventType,
      entityId: result.entityId || null,
      status: result.status,
      recordedAt: clientRecordedAt,
      receivedAt: serverTime,
      conflictReason: result.conflictReason || null,
      responseJson: JSON.stringify(result),
    },
  });

  return result;
}

/**
 * Processes an offline MOVEMENT event.
 * Handles contradictory movements, creates return tasks, and preserves event history.
 */
async function processMovementEvent(
  ctx: SyncProcessorContext,
  event: ClientMovementEvent,
  clientRecordedAt: Date
): Promise<SyncEventResult> {
  const { tx, session, policy, serverTime } = ctx;

  // Authorization check
  if (!hasPermission(session.role, "canRecordMovements")) {
    return {
      clientEventId: event.clientEventId,
      eventType: "MOVEMENT",
      status: "REJECTED",
      error: `El rol ${session.role} no tiene permisos para registrar movimientos`,
      clientRecordedAt: clientRecordedAt.toISOString(),
      serverReceivedAt: serverTime.toISOString(),
    };
  }

  if (!event.plate || !event.movementType) {
    return {
      clientEventId: event.clientEventId,
      eventType: "MOVEMENT",
      status: "REJECTED",
      error: "Placa y tipo de movimiento requeridos",
      clientRecordedAt: clientRecordedAt.toISOString(),
      serverReceivedAt: serverTime.toISOString(),
    };
  }

  const normalizedPlate = event.plate.trim().toUpperCase();

  // Find or create vehicle
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
    vehicle = await tx.vehicle.create({
      data: {
        complexId: session.complexId,
        plate: normalizedPlate,
      },
      include: { presence: true },
    });

    await tx.vehiclePresence.create({
      data: {
        vehicleId: vehicle.id,
        currentStatus: event.movementType === "ARRIVAL" ? "INSIDE" : "AWAY",
        statusUpdatedAt: clientRecordedAt,
      },
    });
  }

  const currentPresence = vehicle.presence?.currentStatus || "AWAY";

  // Check for contradiction: e.g. ARRIVAL when already INSIDE, or DEPARTURE when already AWAY
  const isContradictory =
    (event.movementType === "ARRIVAL" && currentPresence === "INSIDE") ||
    (event.movementType === "DEPARTURE" && currentPresence === "AWAY");

  // Always record the movement event in the append-only log (Never discard history!)
  const movement = await tx.vehicleMovementEvent.create({
    data: {
      complexId: session.complexId,
      vehicleId: vehicle.id,
      eventType: event.movementType,
      recordedAt: clientRecordedAt, // Client observation time
      recordedById: session.userId,
      source: event.source || "GATE_MANUAL",
      idempotencyKey: event.clientEventId,
      notes: event.notes,
      createdAt: serverTime, // Server receipt time
    },
  });

  if (isContradictory) {
    // Conflict handling: Mark presence as UNCERTAIN and alert supervisor
    await tx.vehiclePresence.upsert({
      where: { vehicleId: vehicle.id },
      update: {
        currentStatus: "UNCERTAIN",
        lastMovementEventId: movement.id,
        statusUpdatedAt: clientRecordedAt,
        verificationDetails: `Conflicto de sincronización offline: recibido ${event.movementType} cuando el estado previo ya era ${currentPresence}.`,
      },
      create: {
        vehicleId: vehicle.id,
        currentStatus: "UNCERTAIN",
        lastMovementEventId: movement.id,
        statusUpdatedAt: clientRecordedAt,
        verificationDetails: `Conflicto de sincronización offline inicial.`,
      },
    });

    // Alert supervisor
    await tx.notification.create({
      data: {
        complexId: session.complexId,
        targetRole: "SUPERVISOR",
        type: "UNCERTAIN_PRESENCE_ALERT",
        title: "Conflicto de Movimiento Offline",
        message: `El vehículo ${vehicle.plate} reportó un evento contradictorio (${event.movementType} con presencia previa ${currentPresence}). Marcado como INCIERTO.`,
        entityType: "VEHICLE",
        entityId: vehicle.id,
      },
    });

    return {
      clientEventId: event.clientEventId,
      eventType: "MOVEMENT",
      status: "CONFLICT_FLAGGED",
      entityId: movement.id,
      conflictReason: `Presencia contradictoria detectada (${event.movementType} sobre ${currentPresence}). Estado asignado a INCIERTO para revisión.`,
      clientRecordedAt: clientRecordedAt.toISOString(),
      serverReceivedAt: serverTime.toISOString(),
    };
  }

  // Normal movement transition
  const newPresence = derivePresenceFromMovement(currentPresence as any, event.movementType);

  await tx.vehiclePresence.upsert({
    where: { vehicleId: vehicle.id },
    update: {
      currentStatus: newPresence,
      lastMovementEventId: movement.id,
      statusUpdatedAt: clientRecordedAt,
    },
    create: {
      vehicleId: vehicle.id,
      currentStatus: newPresence,
      lastMovementEventId: movement.id,
      statusUpdatedAt: clientRecordedAt,
    },
  });

  if (event.movementType === "ARRIVAL") {
    // Create RETURN inspection obligation
    const returnTask = buildReturnInspectionTask(
      session.complexId,
      vehicle.id,
      movement.id,
      clientRecordedAt,
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
        createdAt: clientRecordedAt,
        updatedAt: serverTime,
      },
    });

    // Notify parking guards of incoming return inspection
    await tx.notification.create({
      data: {
        complexId: session.complexId,
        targetRole: "PARKING_GUARD",
        type: "RETURN_INSPECTION_CREATED",
        title: "Nuevo Retorno de Vehículo",
        message: `El vehículo ${vehicle.plate} ha ingresado. Inspección de retorno pendiente.`,
        entityType: "TASK",
        entityId: returnTask.id,
      },
    });
  } else if (event.movementType === "DEPARTURE") {
    // Preserve all outstanding tasks!
    const existingTasks = await tx.inspectionTask.findMany({
      where: {
        vehicleId: vehicle.id,
        status: { in: ["PENDING", "OVERDUE"] },
      },
    });

    const mappedTasks = existingTasks.map((t: any) => ({
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

    handleVehicleDeparture(
      mappedTasks,
      {
        id: movement.id,
        complexId: movement.complexId,
        vehicleId: movement.vehicleId,
        eventType: "DEPARTURE",
        recordedAt: clientRecordedAt,
        source: event.source || "GATE_MANUAL",
      },
      policy
    );
  }

  return {
    clientEventId: event.clientEventId,
    eventType: "MOVEMENT",
    status: "ACKNOWLEDGED",
    entityId: movement.id,
    clientRecordedAt: clientRecordedAt.toISOString(),
    serverReceivedAt: serverTime.toISOString(),
  };
}

/**
 * Processes an offline INSPECTION event.
 */
async function processInspectionEvent(
  ctx: SyncProcessorContext,
  event: ClientInspectionEvent,
  clientRecordedAt: Date
): Promise<SyncEventResult> {
  const { tx, session, serverTime } = ctx;

  if (!hasPermission(session.role, "canPerformInspections")) {
    return {
      clientEventId: event.clientEventId,
      eventType: "INSPECTION",
      status: "REJECTED",
      error: `El rol ${session.role} no tiene permisos para realizar inspecciones`,
      clientRecordedAt: clientRecordedAt.toISOString(),
      serverReceivedAt: serverTime.toISOString(),
    };
  }

  // Find task: by taskId or by active task for vehicle plate
  let task = await tx.inspectionTask.findFirst({
    where: {
      id: event.taskId,
      complexId: session.complexId,
    },
    include: { vehicle: true },
  });

  if (!task && event.vehiclePlate) {
    const normalizedPlate = event.vehiclePlate.trim().toUpperCase();
    task = await tx.inspectionTask.findFirst({
      where: {
        complexId: session.complexId,
        vehicle: { plate: normalizedPlate },
        status: { in: ["PENDING", "OVERDUE"] },
      },
      include: { vehicle: true },
      orderBy: { dueAt: "asc" },
    });
  }

  if (!task) {
    return {
      clientEventId: event.clientEventId,
      eventType: "INSPECTION",
      status: "REJECTED",
      error: `Tarea de inspección no encontrada (${event.taskId}) en este conjunto`,
      clientRecordedAt: clientRecordedAt.toISOString(),
      serverReceivedAt: serverTime.toISOString(),
    };
  }

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

  const updatedTask = submitTaskResult(
    mappedTask,
    clientRecordedAt,
    event.result === "UNABLE_TO_COMPLETE" ? "UNABLE_TO_COMPLETE" : "COMPLETED",
    event.unableToCompleteReason
  );

  // Update task
  await tx.inspectionTask.update({
    where: { id: task.id },
    data: {
      status: updatedTask.status,
      completedAt: updatedTask.completedAt,
      isLate: updatedTask.isLate,
      unableToCompleteReason: updatedTask.unableToCompleteReason,
      updatedAt: serverTime,
    },
  });

  // Create InspectionRecord
  const record = await tx.inspectionRecord.create({
    data: {
      complexId: session.complexId,
      vehicleId: task.vehicleId,
      taskId: task.id,
      inspectedAt: clientRecordedAt,
      inspectedById: session.userId,
      result: event.result,
      description: event.description || null,
      createdAt: serverTime,
    },
  });

  // If damage observed, create incident
  if (event.result === "DAMAGE_OBSERVED") {
    const incidentData = createDamageIncident({
      complexId: session.complexId,
      vehicleId: task.vehicleId,
      inspectionRecordId: record.id,
      reportedById: session.userId,
      observedAt: clientRecordedAt,
      description: event.description || "Daño observado durante inspección",
      surveillanceRequired: event.surveillanceRequired,
      ownerContactRequired: event.ownerContactRequired,
    });

    const incident = await tx.incident.create({
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
        createdAt: serverTime,
      },
    });

    await tx.incidentFollowUp.create({
      data: {
        incidentId: incident.id,
        actionType: "NOTE",
        description: `Incidente registrado por guarda (Offline Sync): ${incidentData.description}`,
        performedById: session.userId,
        performedAt: clientRecordedAt,
        createdAt: serverTime,
      },
    });

    // Notify supervisor
    await tx.notification.create({
      data: {
        complexId: session.complexId,
        targetRole: "SUPERVISOR",
        type: "DAMAGE_REPORTED",
        title: "Nuevo Daño Observado (Sync)",
        message: `Vehículo ${task.vehicle.plate}: ${incidentData.description}`,
        entityType: "INCIDENT",
        entityId: incident.id,
      },
    });
  }

  return {
    clientEventId: event.clientEventId,
    eventType: "INSPECTION",
    status: "ACKNOWLEDGED",
    entityId: record.id,
    clientRecordedAt: clientRecordedAt.toISOString(),
    serverReceivedAt: serverTime.toISOString(),
  };
}

/**
 * Processes an offline INCIDENT event.
 */
async function processIncidentEvent(
  ctx: SyncProcessorContext,
  event: ClientIncidentEvent,
  clientRecordedAt: Date
): Promise<SyncEventResult> {
  const { tx, session, serverTime } = ctx;

  if (!hasPermission(session.role, "canReportIncidents")) {
    return {
      clientEventId: event.clientEventId,
      eventType: "INCIDENT",
      status: "REJECTED",
      error: `El rol ${session.role} no tiene permisos para reportar incidentes`,
      clientRecordedAt: clientRecordedAt.toISOString(),
      serverReceivedAt: serverTime.toISOString(),
    };
  }

  const normalizedPlate = event.vehiclePlate.trim().toUpperCase();

  let vehicle = await tx.vehicle.findUnique({
    where: {
      complexId_plate: {
        complexId: session.complexId,
        plate: normalizedPlate,
      },
    },
  });

  if (!vehicle) {
    vehicle = await tx.vehicle.create({
      data: {
        complexId: session.complexId,
        plate: normalizedPlate,
      },
    });
  }

  const incidentData = createDamageIncident({
    complexId: session.complexId,
    vehicleId: vehicle.id,
    reportedById: session.userId,
    observedAt: clientRecordedAt,
    description: event.description,
    surveillanceRequired: event.surveillanceRequired,
    ownerContactRequired: event.ownerContactRequired,
  });

  const incident = await tx.incident.create({
    data: {
      id: incidentData.id,
      complexId: incidentData.complexId,
      vehicleId: incidentData.vehicleId,
      reportedById: incidentData.reportedById,
      observedAt: incidentData.observedAt,
      description: incidentData.description,
      status: incidentData.status,
      surveillanceRequired: incidentData.surveillanceRequired,
      ownerContactRequired: incidentData.ownerContactRequired,
      createdAt: serverTime,
    },
  });

  await tx.incidentFollowUp.create({
    data: {
      incidentId: incident.id,
      actionType: "NOTE",
      description: `Reporte de incidente creado (Offline Sync): ${incidentData.description}`,
      performedById: session.userId,
      performedAt: clientRecordedAt,
      createdAt: serverTime,
    },
  });

  // Notify supervisor
  await tx.notification.create({
    data: {
      complexId: session.complexId,
      targetRole: "SUPERVISOR",
      type: "DAMAGE_REPORTED",
      title: "Nuevo Daño Reportado (Offline Sync)",
      message: `Vehículo ${vehicle.plate}: ${incidentData.description}`,
      entityType: "INCIDENT",
      entityId: incident.id,
    },
  });

  return {
    clientEventId: event.clientEventId,
    eventType: "INCIDENT",
    status: "ACKNOWLEDGED",
    entityId: incident.id,
    clientRecordedAt: clientRecordedAt.toISOString(),
    serverReceivedAt: serverTime.toISOString(),
  };
}

/**
 * Processes an offline ATTACHMENT event.
 */
async function processAttachmentEvent(
  ctx: SyncProcessorContext,
  event: ClientAttachmentEvent,
  clientRecordedAt: Date
): Promise<SyncEventResult> {
  const { tx, session, serverTime } = ctx;

  let incidentId = event.incidentServerId;

  // Resolve incident by clientEventId if provided
  if (!incidentId && event.incidentClientEventId) {
    const parentLog = await tx.syncEventLog.findUnique({
      where: {
        complexId_clientEventId: {
          complexId: session.complexId,
          clientEventId: event.incidentClientEventId,
        },
      },
    });

    if (parentLog?.entityId) {
      incidentId = parentLog.entityId;
    }
  }

  if (!incidentId) {
    return {
      clientEventId: event.clientEventId,
      eventType: "ATTACHMENT",
      status: "REJECTED",
      error: "Incidente asociado no encontrado para este adjunto",
      clientRecordedAt: clientRecordedAt.toISOString(),
      serverReceivedAt: serverTime.toISOString(),
    };
  }

  // Handle file persistence if base64Data is provided
  let storageKey = `attachments/${session.complexId}/${Date.now()}-${event.originalName}`;
  if (event.base64Data) {
    const buffer = Buffer.from(event.base64Data, "base64");
    const saved = await saveAttachmentFile(session.complexId, event.originalName, buffer);
    storageKey = saved.storageKey;
  }

  const attachment = await tx.incidentAttachment.create({
    data: {
      incidentId,
      storageKey,
      originalName: event.originalName,
      mimeType: event.mimeType || "image/jpeg",
      fileSize: event.fileSize || 0,
      attachmentType: event.attachmentType || "DAMAGE_PHOTO",
      uploadedAt: serverTime,
    },
  });

  return {
    clientEventId: event.clientEventId,
    eventType: "ATTACHMENT",
    status: "ACKNOWLEDGED",
    entityId: attachment.id,
    clientRecordedAt: clientRecordedAt.toISOString(),
    serverReceivedAt: serverTime.toISOString(),
  };
}
