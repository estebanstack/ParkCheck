// ParkCheck Mobile - API Client with Bearer Authentication
// Specification Reference: Section 4, 6, 8

import { SyncBatchRequest, SyncBatchResponse } from "../../../src/domain/syncTypes";
import { AuthSession } from "../types/outbox";

// Default API Base URL: 127.0.0.1:3000 (accessible via `adb reverse tcp:3000 tcp:3000` on physical device)
let API_BASE_URL = "http://127.0.0.1:3000";

export function setApiBaseUrl(url: string) {
  API_BASE_URL = url.replace(/\/$/, "");
}

export function getApiBaseUrl(): string {
  return API_BASE_URL;
}

export const ApiClient = {
  async login(
    email: string,
    password: string,
    complexId?: string
  ): Promise<{ success: boolean; token: string; user: AuthSession["user"] }> {
    const res = await fetch(`${API_BASE_URL}/api/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password, complexId }),
    });

    const data = await res.json();
    if (!res.ok) {
      throw new Error(data.error || "Error al iniciar sesión");
    }

    return data;
  },

  async fetchManifest(token: string): Promise<any> {
    const res = await fetch(`${API_BASE_URL}/api/sync/manifest`, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
    });

    const data = await res.json();
    if (!res.ok) {
      throw new Error(data.error || "Error al descargar manifiesto");
    }

    return data;
  },

  async syncBatch(token: string, batch: SyncBatchRequest): Promise<SyncBatchResponse> {
    const res = await fetch(`${API_BASE_URL}/api/sync/batch`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(batch),
    });

    const data = await res.json();
    if (!res.ok) {
      throw new Error(data.error || "Error al sincronizar lote");
    }

    return data as SyncBatchResponse;
  },

  async uploadAttachment(
    token: string,
    payload: {
      incidentId?: string;
      incidentClientEventId?: string;
      originalName: string;
      mimeType: string;
      base64Data: string;
    }
  ): Promise<any> {
    const res = await fetch(`${API_BASE_URL}/api/attachments/upload`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });

    const data = await res.json();
    if (!res.ok) {
      throw new Error(data.error || "Error al subir evidencia fotográfica");
    }

    return data;
  },
};
