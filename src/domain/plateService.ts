// ParkCheck - License Plate Normalization, Validation & OCR Candidate Extraction
// Specification Reference: Section 2, 3, 4 (Colombian standard plates: Automobile & Motorcycle)

export type PlateVehicleType = "AUTOMOBILE" | "MOTORCYCLE" | "SPECIAL";

export interface PlateValidationResult {
  isValid: boolean;
  normalizedPlate: string;
  vehicleType?: PlateVehicleType;
  error?: string;
}

export interface PlateCandidate {
  plate: string;
  vehicleType: PlateVehicleType;
  confidence: number; // 0.0 to 1.0
  isDirectMatch: boolean;
}

/**
 * Normalizes any plate string:
 * - Trims leading/trailing whitespace
 * - Converts to uppercase
 * - Removes hyphens, spaces, dots, and non-alphanumeric characters
 */
export function normalizePlate(input: string): string {
  if (!input) return "";
  return input
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "");
}

/**
 * Validates a plate against official Colombian registration formats:
 * - Automobile: 3 letters + 3 digits (e.g. "ABC123", "KHY842")
 * - Motorcycle: 3 letters + 2 digits + 1 letter (e.g. "ABC12D", "KHY84B")
 * - Special / Diplomatic: 1-2 letters + 4-5 digits (e.g. "D01234")
 */
export function validatePlateFormat(rawPlate: string): PlateValidationResult {
  const normalized = normalizePlate(rawPlate);

  if (!normalized) {
    return { isValid: false, normalizedPlate: "", error: "La placa no puede estar vacía" };
  }

  // Automobile format: 3 letters + 3 numbers
  if (/^[A-Z]{3}[0-9]{3}$/.test(normalized)) {
    return {
      isValid: true,
      normalizedPlate: normalized,
      vehicleType: "AUTOMOBILE",
    };
  }

  // Motorcycle format: 3 letters + 2 numbers + 1 letter
  if (/^[A-Z]{3}[0-9]{2}[A-Z]$/.test(normalized)) {
    return {
      isValid: true,
      normalizedPlate: normalized,
      vehicleType: "MOTORCYCLE",
    };
  }

  // Special/Diplomatic format: 1 or 2 letters + 4 or 5 numbers
  if (/^[A-Z]{1,2}[0-9]{4,5}$/.test(normalized)) {
    return {
      isValid: true,
      normalizedPlate: normalized,
      vehicleType: "SPECIAL",
    };
  }

  return {
    isValid: false,
    normalizedPlate: normalized,
    error: `Formato de placa inválido ('${normalized}'). Formatos válidos: ABC123 (automóvil) o ABC12D (moto).`,
  };
}

/**
 * Extracts and scores potential Colombian license plate candidates from OCR text output.
 * Handles common OCR misreadings (e.g. letter O read as 0, or digit 0 read as O).
 */
export function extractPlateCandidates(rawOcrText: string): PlateCandidate[] {
  if (!rawOcrText) return [];

  const candidates: PlateCandidate[] = [];
  const seen = new Set<string>();

  // 1. Direct Regex search on full text for Colombian patterns with optional separators (e.g. KHY-842, KHY 842, ABC-12D)
  const carRegex = /\b([A-Z]{3})[\s\-_.]*([0-9]{3})\b/gi;
  let match;
  while ((match = carRegex.exec(rawOcrText)) !== null) {
    const plate = `${match[1]}${match[2]}`.toUpperCase();
    if (!seen.has(plate)) {
      seen.add(plate);
      candidates.push({
        plate,
        vehicleType: "AUTOMOBILE",
        confidence: 0.98,
        isDirectMatch: true,
      });
    }
  }

  const motoRegex = /\b([A-Z]{3})[\s\-_.]*([0-9]{2})[\s\-_.]*([A-Z])\b/gi;
  while ((match = motoRegex.exec(rawOcrText)) !== null) {
    const plate = `${match[1]}${match[2]}${match[3]}`.toUpperCase();
    if (!seen.has(plate)) {
      seen.add(plate);
      candidates.push({
        plate,
        vehicleType: "MOTORCYCLE",
        confidence: 0.98,
        isDirectMatch: true,
      });
    }
  }

  // 2. Evaluate individual stripped lines
  const lines = rawOcrText.toUpperCase().split(/\r?\n/);
  for (const line of lines) {
    const stripped = line.replace(/[^A-Z0-9]/g, "");
    if (stripped.length >= 6 && stripped.length <= 7) {
      const val = validatePlateFormat(stripped);
      if (val.isValid && !seen.has(val.normalizedPlate)) {
        seen.add(val.normalizedPlate);
        candidates.push({
          plate: val.normalizedPlate,
          vehicleType: val.vehicleType!,
          confidence: 0.95,
          isDirectMatch: true,
        });
      }
    }
  }

  // 3. Clean tokens and apply character substitution heuristics (e.g. O <-> 0, I <-> 1)
  const tokens = rawOcrText
    .toUpperCase()
    .split(/[\s\n\r,.;:\-_]+/)
    .map((t) => t.replace(/[^A-Z0-9]/g, ""))
    .filter((t) => t.length >= 5 && t.length <= 8);

  for (const token of tokens) {
    // 1. Direct validation check
    const validation = validatePlateFormat(token);
    if (validation.isValid && !seen.has(validation.normalizedPlate)) {
      seen.add(validation.normalizedPlate);
      candidates.push({
        plate: validation.normalizedPlate,
        vehicleType: validation.vehicleType!,
        confidence: 0.95,
        isDirectMatch: true,
      });
      continue;
    }

    // 2. Automobile heuristic substitution: first 3 characters should be letters, last 3 numbers
    if (token.length === 6) {
      const fixedLetters = token
        .substring(0, 3)
        .replace(/0/g, "O")
        .replace(/1/g, "I")
        .replace(/8/g, "B")
        .replace(/5/g, "S");

      const fixedDigits = token
        .substring(3, 6)
        .replace(/O/g, "0")
        .replace(/I/g, "1")
        .replace(/B/g, "8")
        .replace(/S/g, "5")
        .replace(/Z/g, "2");

      const corrected = `${fixedLetters}${fixedDigits}`;
      if (/^[A-Z]{3}[0-9]{3}$/.test(corrected) && !seen.has(corrected)) {
        seen.add(corrected);
        candidates.push({
          plate: corrected,
          vehicleType: "AUTOMOBILE",
          confidence: 0.85,
          isDirectMatch: false,
        });
        continue;
      }

      // Motorcycle heuristic: 3 letters + 2 numbers + 1 letter
      const motoLetters = token.substring(0, 3).replace(/0/g, "O").replace(/1/g, "I");
      const motoDigits = token.substring(3, 5).replace(/O/g, "0").replace(/I/g, "1").replace(/B/g, "8");
      const motoLastLetter = token.substring(5, 6).replace(/0/g, "O").replace(/1/g, "I");
      const motoCorrected = `${motoLetters}${motoDigits}${motoLastLetter}`;
      if (/^[A-Z]{3}[0-9]{2}[A-Z]$/.test(motoCorrected) && !seen.has(motoCorrected)) {
        seen.add(motoCorrected);
        candidates.push({
          plate: motoCorrected,
          vehicleType: "MOTORCYCLE",
          confidence: 0.8,
          isDirectMatch: false,
        });
      }
    }
  }

  // Sort by confidence descending
  return candidates.sort((a, b) => b.confidence - a.confidence);
}

/**
 * Validates the intended gate movement against the vehicle's known presence status.
 * Returns whether a conflict warning is required.
 */
export function validateGateMovementIntent(
  currentPresence: "INSIDE" | "AWAY" | "UNCERTAIN",
  intendedMovement: "ARRIVAL" | "DEPARTURE"
): {
  isNormal: boolean;
  isContradictory: boolean;
  warningMessage?: string;
} {
  if (currentPresence === "UNCERTAIN") {
    return {
      isNormal: false,
      isContradictory: true,
      warningMessage:
        "Presencia previa INCIERTA: Requiere verificación física del guarda antes de confirmar.",
    };
  }

  if (intendedMovement === "ARRIVAL") {
    if (currentPresence === "INSIDE") {
      return {
        isNormal: false,
        isContradictory: true,
        warningMessage:
          "Atención: El vehículo ya figura DENTRO del conjunto. Si confirma el ingreso, se registrará un conflicto de presencia para supervisión.",
      };
    }
    return { isNormal: true, isContradictory: false };
  }

  if (intendedMovement === "DEPARTURE") {
    if (currentPresence === "AWAY") {
      return {
        isNormal: false,
        isContradictory: true,
        warningMessage:
          "Atención: El vehículo ya figura FUERA del conjunto. Si confirma la salida, se registrará un conflicto de presencia para supervisión.",
      };
    }
    return { isNormal: true, isContradictory: false };
  }

  return { isNormal: true, isContradictory: false };
}
