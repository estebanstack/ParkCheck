// ParkCheck - Damage & Incident Lifecycle Logic
// Specification Reference: Section 3.4, 10, 15

import { IncidentStatus } from "./types";

export interface CreateIncidentInput {
  complexId: string;
  vehicleId: string;
  inspectionRecordId?: string | null;
  reportedById: string;
  observedAt: Date;
  description: string;
  surveillanceRequired?: boolean;
  ownerContactRequired?: boolean;
}

export interface IncidentEntity {
  id: string;
  complexId: string;
  vehicleId: string;
  inspectionRecordId?: string | null;
  reportedById: string;
  observedAt: Date;
  description: string;
  status: IncidentStatus;
  surveillanceRequired: boolean;
  surveillanceOutcome?: string | null;
  ownerContactRequired: boolean;
  ownerContactedAt?: Date | null;
  ownerContactNotes?: string | null;
  resolutionNotes?: string | null;
  resolvedAt?: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface FollowUpRecord {
  id: string;
  incidentId: string;
  actionType: "NOTE" | "SURVEILLANCE_REVIEW" | "OWNER_CONTACT_ATTEMPT" | "STATUS_CHANGE" | "RESOLUTION";
  description: string;
  performedById: string;
  performedAt: Date;
  outcome?: string | null;
}

export interface OwnerContactOptions {
  contactMethod?: "INTERCOM" | "PHONE" | "IN_PERSON" | "EMAIL" | "WRITTEN_NOTICE" | string;
  nextAction?: string;
}

/**
 * Valid transitions for IncidentStatus:
 * REPORTED -> AWAITING_REVIEW -> UNDER_INVESTIGATION -> OWNER_CONTACT_PENDING -> OWNER_CONTACTED -> RESOLVED -> CLOSED
 */
export const VALID_INCIDENT_TRANSITIONS: Record<IncidentStatus, readonly IncidentStatus[]> = {
  REPORTED: ["AWAITING_REVIEW", "UNDER_INVESTIGATION"],
  AWAITING_REVIEW: ["UNDER_INVESTIGATION", "OWNER_CONTACT_PENDING", "RESOLVED"],
  UNDER_INVESTIGATION: ["OWNER_CONTACT_PENDING", "OWNER_CONTACTED", "RESOLVED"],
  OWNER_CONTACT_PENDING: ["OWNER_CONTACTED", "UNDER_INVESTIGATION", "RESOLVED"],
  OWNER_CONTACTED: ["RESOLVED", "UNDER_INVESTIGATION", "OWNER_CONTACT_PENDING"],
  RESOLVED: ["CLOSED"],
  CLOSED: [],
};

export function isTransitionAllowed(currentStatus: IncidentStatus, newStatus: IncidentStatus): boolean {
  if (currentStatus === newStatus) return false;
  const allowed = VALID_INCIDENT_TRANSITIONS[currentStatus];
  return !!allowed && allowed.includes(newStatus);
}

/**
 * Creates an incident record from a guard's observation.
 * Core requirement: A damage report is an observation, not proof of causation.
 * Notifications or creations do NOT automatically close the incident.
 */
export function createDamageIncident(input: CreateIncidentInput): IncidentEntity {
  return {
    id: `inc-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`,
    complexId: input.complexId,
    vehicleId: input.vehicleId,
    inspectionRecordId: input.inspectionRecordId || null,
    reportedById: input.reportedById,
    observedAt: input.observedAt,
    description: input.description,
    status: "REPORTED",
    surveillanceRequired: !!input.surveillanceRequired,
    surveillanceOutcome: null,
    ownerContactRequired: !!input.ownerContactRequired,
    ownerContactedAt: null,
    ownerContactNotes: null,
    resolutionNotes: null,
    resolvedAt: null,
    createdAt: input.observedAt,
    updatedAt: input.observedAt,
  };
}

/**
 * Validates and transitions incident status through the official state machine.
 * Prevents premature closure and requires notes for resolution/closure.
 */
export function transitionIncidentStatus(
  incident: IncidentEntity,
  newStatus: IncidentStatus,
  actionNotes: string,
  performedById: string,
  performedAt: Date
): { updatedIncident: IncidentEntity; followUp: FollowUpRecord } {
  if (incident.status === "CLOSED") {
    throw new Error("Transición rechazada: un incidente en estado 'CLOSED' no puede ser modificado.");
  }

  if (incident.status === newStatus) {
    throw new Error(`El incidente ya se encuentra en estado '${newStatus}'.`);
  }

  if (!isTransitionAllowed(incident.status, newStatus)) {
    throw new Error(
      `Transición de estado no permitida: de '${incident.status}' a '${newStatus}'. Los incidentes deben seguir el ciclo de vida oficial.`
    );
  }

  const cleanNotes = actionNotes?.trim() || "";

  if (newStatus === "RESOLVED" && !cleanNotes) {
    throw new Error("Se requieren notas de resolución para marcar el incidente como RESUELTO.");
  }

  if (newStatus === "CLOSED" && !cleanNotes) {
    throw new Error("Se requieren notas o justificación de cierre para archivar el incidente como CERRADO.");
  }

  const updatedIncident: IncidentEntity = {
    ...incident,
    status: newStatus,
    updatedAt: performedAt,
  };

  if (newStatus === "RESOLVED") {
    updatedIncident.resolvedAt = performedAt;
    updatedIncident.resolutionNotes = cleanNotes;
  } else if (newStatus === "CLOSED") {
    if (!updatedIncident.resolvedAt) {
      updatedIncident.resolvedAt = performedAt;
    }
  }

  const actionDescription =
    newStatus === "RESOLVED"
      ? `Incidente marcado como RESUELTO: ${cleanNotes}`
      : newStatus === "CLOSED"
      ? `Incidente CERRADO formalmente: ${cleanNotes}`
      : `Estado actualizado a ${newStatus}: ${cleanNotes}`;

  const followUp: FollowUpRecord = {
    id: `fup-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`,
    incidentId: incident.id,
    actionType: newStatus === "RESOLVED" ? "RESOLUTION" : "STATUS_CHANGE",
    description: actionDescription,
    performedById,
    performedAt,
    outcome: newStatus,
  };

  return { updatedIncident, followUp };
}

/**
 * Records CCTV surveillance review findings and outcome.
 */
export function recordSurveillanceOutcome(
  incident: IncidentEntity,
  outcome: string,
  performedById: string,
  performedAt: Date,
  options?: {
    advanceToUnderInvestigation?: boolean;
    observations?: string;
  }
): { updatedIncident: IncidentEntity; followUp: FollowUpRecord } {
  if (incident.status === "CLOSED") {
    throw new Error("No se pueden registrar revisiones de CCTV en un incidente CERRADO.");
  }

  const cleanOutcome = outcome?.trim() || "";
  if (!cleanOutcome) {
    throw new Error("El resultado de la revisión de cámaras de seguridad es requerido.");
  }

  let nextStatus = incident.status;
  if (
    options?.advanceToUnderInvestigation &&
    (incident.status === "REPORTED" || incident.status === "AWAITING_REVIEW")
  ) {
    nextStatus = "UNDER_INVESTIGATION";
  }

  if (nextStatus !== incident.status && !isTransitionAllowed(incident.status, nextStatus)) {
    throw new Error(
      `Transición de estado no permitida para revisión de cámaras: de '${incident.status}' a '${nextStatus}'.`
    );
  }

  const detailDesc = options?.observations
    ? `Revisión de cámaras de seguridad: ${cleanOutcome} (Observaciones: ${options.observations})`
    : `Revisión de cámaras de seguridad: ${cleanOutcome}`;

  const updatedIncident: IncidentEntity = {
    ...incident,
    status: nextStatus,
    surveillanceOutcome: cleanOutcome,
    updatedAt: performedAt,
  };

  const followUp: FollowUpRecord = {
    id: `fup-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`,
    incidentId: incident.id,
    actionType: "SURVEILLANCE_REVIEW",
    description: detailDesc,
    performedById,
    performedAt,
    outcome: cleanOutcome,
  };

  return { updatedIncident, followUp };
}

/**
 * Records owner contact attempt or completion by the entrance guard or supervisor.
 */
export function recordOwnerContact(
  incident: IncidentEntity,
  contactSuccessful: boolean,
  notes: string,
  performedById: string,
  performedAt: Date,
  options?: OwnerContactOptions
): { updatedIncident: IncidentEntity; followUp: FollowUpRecord } {
  if (incident.status === "CLOSED") {
    throw new Error("No se pueden registrar contactos con el propietario en un incidente CERRADO.");
  }
  if (incident.status === "RESOLVED") {
    throw new Error("No se pueden registrar contactos con el propietario en un incidente ya RESUELTO.");
  }

  const cleanNotes = notes?.trim() || "";
  if (!cleanNotes) {
    throw new Error("Las notas o resultado del contacto con el propietario son requeridos.");
  }

  const targetStatus: IncidentStatus = contactSuccessful ? "OWNER_CONTACTED" : "OWNER_CONTACT_PENDING";

  if (incident.status !== targetStatus && !isTransitionAllowed(incident.status, targetStatus)) {
    throw new Error(
      `Transición de estado no permitida para contacto con propietario: de '${incident.status}' a '${targetStatus}'. Los incidentes deben seguir el ciclo de vida oficial.`
    );
  }

  const updatedIncident: IncidentEntity = {
    ...incident,
    status: targetStatus,
    ownerContactedAt: contactSuccessful ? performedAt : incident.ownerContactedAt,
    ownerContactNotes: cleanNotes,
    updatedAt: performedAt,
  };

  const methodPrefix = options?.contactMethod ? ` vía ${options.contactMethod}` : "";
  const nextActionSuffix = options?.nextAction ? ` | Próxima acción: ${options.nextAction}` : "";
  const description = `Contacto con propietario (${contactSuccessful ? "Exitoso" : "Pendiente"}${methodPrefix}): ${cleanNotes}${nextActionSuffix}`;

  const followUp: FollowUpRecord = {
    id: `fup-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`,
    incidentId: incident.id,
    actionType: "OWNER_CONTACT_ATTEMPT",
    description,
    performedById,
    performedAt,
    outcome: contactSuccessful ? "CONTACTED" : "RETRY_NEEDED",
  };

  return { updatedIncident, followUp };
}

/**
 * Records supervisor investigation notes and follow-up directives.
 */
export function recordInvestigationNote(
  incident: IncidentEntity,
  note: string,
  performedById: string,
  performedAt: Date,
  options?: { nextAction?: string }
): { updatedIncident: IncidentEntity; followUp: FollowUpRecord } {
  if (incident.status === "CLOSED") {
    throw new Error("No se pueden agregar notas de investigación a un incidente CERRADO.");
  }

  const cleanNote = note?.trim() || "";
  if (!cleanNote) {
    throw new Error("El texto de la nota de investigación es requerido.");
  }

  const nextActionSuffix = options?.nextAction ? ` | Próxima acción: ${options.nextAction}` : "";
  const description = `Nota de investigación: ${cleanNote}${nextActionSuffix}`;

  const updatedIncident: IncidentEntity = {
    ...incident,
    updatedAt: performedAt,
  };

  const followUp: FollowUpRecord = {
    id: `fup-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`,
    incidentId: incident.id,
    actionType: "NOTE",
    description,
    performedById,
    performedAt,
    outcome: options?.nextAction || "NOTE_RECORDED",
  };

  return { updatedIncident, followUp };
}

