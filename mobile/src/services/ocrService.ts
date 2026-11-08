// ParkCheck Mobile - On-Device Plate OCR & Manifest Lookup Service
// Specification Reference: Section 1, 2, 3, 5
// Strictly Real Google ML Kit OCR -> Candidate Ranking -> Manifest Lookup
// ZERO simulation, random plate generation, or fake fallback.

import {
  normalizePlate,
  validatePlateFormat,
  extractPlateCandidates,
  validateGateMovementIntent,
  PlateCandidate,
} from "../../../src/domain/plateService";
import { StorageService } from "./storage";
import { CachedVehicle } from "../types/outbox";

// Optional native on-device ML Kit text recognition bridge
let MlKitTextRecognition: any = null;
try {
  const mod = require("@react-native-ml-kit/text-recognition");
  MlKitTextRecognition = mod?.default || mod;
} catch {
  MlKitTextRecognition = null;
}

export interface RecognizedPlateResult {
  rawDetected: string;
  candidates: PlateCandidate[];
  selectedPlate: string;
  isRegistered: boolean;
  registeredVehicle?: CachedVehicle;
  isHardwareOcrAvailable: boolean;
  movementValidation: {
    isNormal: boolean;
    isContradictory: boolean;
    warningMessage?: string;
  };
}

export interface OcrScanResponse {
  success: boolean;
  result?: RecognizedPlateResult;
  error?: string;
  rawText?: string;
}

export const OcrService = {
  /**
   * Internal reference hook for testing dependency injection
   */
  _setNativeDriver(driver: any) {
    MlKitTextRecognition = driver;
  },

  /**
   * Checks whether the native Google ML Kit text recognition driver is compiled and available
   */
  isNativeOcrSupported(): boolean {
    return !!MlKitTextRecognition;
  },

  /**
   * Scans a plate directly from an image file captured from the device camera.
   * Genuinely invokes Google ML Kit on the image URI.
   * If no valid Colombian plate is detected, returns an actionable error.
   * Never generates or accepts a random plate.
   */
  async scanPlateFromImage(
    imageUri: string,
    intendedMovement?: "ARRIVAL" | "DEPARTURE"
  ): Promise<OcrScanResponse> {
    if (!imageUri) {
      return {
        success: false,
        error: "Ruta de imagen de cámara inválida.",
      };
    }

    if (!MlKitTextRecognition) {
      return {
        success: false,
        error:
          "El módulo de reconocimiento óptico (Google ML Kit) no está disponible en este entorno. Utilice el ingreso manual.",
      };
    }

    try {
      const ocrResult = await MlKitTextRecognition.recognize(imageUri);
      const rawText = ocrResult?.text?.trim() || "";

      if (!rawText) {
        return {
          success: false,
          rawText: "",
          error:
            "No se detectó ningún texto en la fotografía. Asegúrese de que la placa esté bien iluminada, limpia y enfocada.",
        };
      }

      const candidates = extractPlateCandidates(rawText);
      if (candidates.length === 0) {
        return {
          success: false,
          rawText,
          error: `Texto detectado ('${rawText.slice(0, 40)}...'), pero no corresponde a un formato de placa colombiana válido (ABC123 o ABC12D). Digite la placa manualmente si la visualiza.`,
        };
      }

      // Valid candidates ranked by confidence
      const primaryCandidate = candidates[0].plate;
      const result = await this.lookupPlateAndValidate(
        primaryCandidate,
        intendedMovement,
        candidates,
        rawText
      );

      return {
        success: true,
        result,
        rawText,
      };
    } catch (err: any) {
      console.warn("Fallo en reconocimiento ML Kit nativo:", err);
      return {
        success: false,
        error:
          err?.message ||
          "Error al procesar la imagen con Google ML Kit. Ingrese la placa manualmente.",
      };
    }
  },

  /**
   * Legacy wrapper that returns RecognizedPlateResult or null
   */
  async recognizeFromImageUri(
    imageUri: string,
    intendedMovement?: "ARRIVAL" | "DEPARTURE"
  ): Promise<RecognizedPlateResult | null> {
    const response = await this.scanPlateFromImage(imageUri, intendedMovement);
    return response.success && response.result ? response.result : null;
  },

  /**
   * Processes recognized text from on-device camera scanner,
   * extracts candidates, and looks up the vehicle in the authorized local manifest.
   */
  async processOcrText(
    rawText: string,
    intendedMovement?: "ARRIVAL" | "DEPARTURE"
  ): Promise<RecognizedPlateResult | null> {
    const candidates = extractPlateCandidates(rawText);
    if (candidates.length === 0) {
      return null;
    }

    const primaryCandidate = candidates[0].plate;
    return await this.lookupPlateAndValidate(
      primaryCandidate,
      intendedMovement,
      candidates,
      rawText
    );
  },

  /**
   * Looks up a specific normalized plate against the authorized vehicle cache,
   * evaluating presence state and gate movement compatibility.
   */
  async lookupPlateAndValidate(
    plateInput: string,
    intendedMovement?: "ARRIVAL" | "DEPARTURE",
    candidates: PlateCandidate[] = [],
    rawText: string = ""
  ): Promise<RecognizedPlateResult> {
    const normalized = normalizePlate(plateInput);
    const cachedVehicles = await StorageService.getCachedVehicles();

    const registered = cachedVehicles.find(
      (v) => normalizePlate(v.plate) === normalized
    );

    const presenceStatus = registered?.presenceStatus || "AWAY";
    const validation = intendedMovement
      ? validateGateMovementIntent(presenceStatus, intendedMovement)
      : { isNormal: true, isContradictory: false };

    return {
      rawDetected: rawText || normalized,
      candidates,
      selectedPlate: normalized,
      isRegistered: !!registered,
      registeredVehicle: registered,
      isHardwareOcrAvailable: !!MlKitTextRecognition,
      movementValidation: validation,
    };
  },

  /**
   * Fast offline plate search for manual typing/search
   */
  async searchCachedVehicles(query: string): Promise<CachedVehicle[]> {
    const clean = normalizePlate(query);
    if (!clean) return [];

    const vehicles = await StorageService.getCachedVehicles();
    return vehicles.filter(
      (v) =>
        normalizePlate(v.plate).includes(clean) ||
        (v.parkingSpace && v.parkingSpace.toUpperCase().includes(clean))
    );
  },
};
