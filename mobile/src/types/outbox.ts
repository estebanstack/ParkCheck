// ParkCheck Mobile - Durable Outbox & Client Types (es-CO)
// Specification Reference: Section 3, 4, 8

export type SyncStatus = "PENDING_SYNC" | "SYNCING" | "SYNCED" | "SYNC_FAILED";

export type EventType = "MOVEMENT" | "INSPECTION" | "INCIDENT" | "ATTACHMENT" | "VEHICLE_REGISTRATION";

export interface OutboxItem {
  clientEventId: string;
  complexId: string;
  eventType: EventType;
  payload: any;
  syncStatus: SyncStatus;
  createdAt: string; // ISO recordedAt timestamp
  retryCount: number;
  lastError?: string;
  serverId?: string;
  conflictFlagged?: boolean;
  conflictReason?: string;
  syncedAt?: string;
}

export interface CachedTask {
  id: string;
  triggerType: "SCHEDULED" | "RETURN";
  status: "PENDING" | "IN_PROGRESS" | "COMPLETED" | "OVERDUE" | "UNABLE_TO_COMPLETE";
  dueAt: string;
  description?: string;
  completedAt?: string;
  outcomeResult?: string;
  unableReason?: string;
}

export interface CachedVehicle {
  id: string;
  complexId?: string;
  plate: string;
  parkingSpace?: string | null;
  stickerToken?: string | null;
  make?: string | null;
  model?: string | null;
  color?: string | null;
  presenceStatus: "INSIDE" | "AWAY" | "UNCERTAIN";
  verificationDetails?: string | null;
  activeTasks: CachedTask[];
  completedTasks?: CachedTask[];
}

export interface LocalIncidentRecord {
  id: string;
  clientEventId: string;
  plate: string;
  category?: string;
  description: string;
  surveillanceRequired: boolean;
  ownerContactRequired: boolean;
  photoUri?: string;
  recordedAt: string;
  reportedBy: string;
  syncStatus?: SyncStatus;
}

export interface AuthSession {
  token: string;
  isOfflineMode?: boolean;
  user: {
    id: string;
    email: string;
    name: string;
    role: "ENTRANCE_GUARD" | "PARKING_GUARD" | "SUPERVISOR" | "RESIDENTIAL_ADMIN" | "PLATFORM_ADMIN";
    complexId: string;
    complexName: string;
  };
}
