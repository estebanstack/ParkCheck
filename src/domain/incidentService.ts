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
 * Valid transitions for IncidentStatus:
 * REPORTED -> AWAITING_REVIEW -> UNDER_INVESTIGATION -> OWNER_CONTACT_PENDING -> OWNER_CONTACTED -> RESOLVED -> CLOSED
 */
export function transitionIncidentStatus(
  incident: IncidentEntity,
  newStatus: IncidentStatus,
  actionNotes: string,
  performedById: string,
  performedAt: Date
): { updatedIncident: IncidentEntity; followUp: FollowUpRecord } {
  const updatedIncident: IncidentEntity = {
    ...incident,
    status: newStatus,
    updatedAt: performedAt,
  };

  if (newStatus === "RESOLVED" || newStatus === "CLOSED") {
    updatedIncident.resolvedAt = performedAt;
    updatedIncident.resolutionNotes = actionNotes;
  }

  const followUp: FollowUpRecord = {
    id: `fup-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`,
    incidentId: incident.id,
    actionType: "STATUS_CHANGE",
    description: `Estado actualizado a ${newStatus}: ${actionNotes}`,
    performedById,
    performedAt,
    outcome: newStatus,
  };

  return { updatedIncident, followUp };
}

/**
 * Records CCTV surveillance review outcome.
 */
export function recordSurveillanceOutcome(
  incident: IncidentEntity,
  outcome: string,
  performedById: string,
  performedAt: Date
): { updatedIncident: IncidentEntity; followUp: FollowUpRecord } {
  const updatedIncident: IncidentEntity = {
    ...incident,
    surveillanceOutcome: outcome,
    updatedAt: performedAt,
  };

  const followUp: FollowUpRecord = {
    id: `fup-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`,
    incidentId: incident.id,
    actionType: "SURVEILLANCE_REVIEW",
    description: `Revisión de cámaras de seguridad: ${outcome}`,
    performedById,
    performedAt,
    outcome,
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
  performedAt: Date
): { updatedIncident: IncidentEntity; followUp: FollowUpRecord } {
  const updatedIncident: IncidentEntity = {
    ...incident,
    status: contactSuccessful ? "OWNER_CONTACTED" : "OWNER_CONTACT_PENDING",
    ownerContactedAt: contactSuccessful ? performedAt : incident.ownerContactedAt,
    ownerContactNotes: notes,
    updatedAt: performedAt,
  };

  const followUp: FollowUpRecord = {
    id: `fup-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`,
    incidentId: incident.id,
    actionType: "OWNER_CONTACT_ATTEMPT",
    description: `Contacto con propietario (${contactSuccessful ? "Exitoso" : "Pendiente"}): ${notes}`,
    performedById,
    performedAt,
    outcome: contactSuccessful ? "CONTACTED" : "RETRY_NEEDED",
  };

  return { updatedIncident, followUp };
}
