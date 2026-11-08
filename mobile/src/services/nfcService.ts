// ParkCheck Mobile - NFC Hardware Service & Detection
// Verifies native NFC capability and provides fallback paths (QR / Manual)

let NfcManager: any = null;
let NfcTech: any = null;

try {
  const nfcModule = require("react-native-nfc-manager");
  NfcManager = nfcModule.default || nfcModule;
  NfcTech = nfcModule.NfcTech;
} catch {
  // Graceful fallback when running in environment without native NFC driver
  NfcManager = null;
}

export interface NfcScanResult {
  success: boolean;
  token?: string;
  error?: string;
  isUnsupported?: boolean;
}

export const NfcService = {
  isInitialized: false,

  async isSupported(): Promise<boolean> {
    if (!NfcManager) return false;
    try {
      return await NfcManager.isSupported();
    } catch {
      return false;
    }
  },

  async isEnabled(): Promise<boolean> {
    if (!NfcManager) return false;
    try {
      return await NfcManager.isEnabled();
    } catch {
      return false;
    }
  },

  async initialize(): Promise<boolean> {
    if (!NfcManager) return false;
    try {
      await NfcManager.start();
      this.isInitialized = true;
      return true;
    } catch (e) {
      console.warn("No fue posible inicializar el controlador NFC:", e);
      return false;
    }
  },

  /**
   * Scans an NFC windshield tag or card and extracts the sticker token.
   * Cleans up listener on completion or error.
   */
  async scanTag(): Promise<NfcScanResult> {
    if (!NfcManager) {
      return {
        success: false,
        isUnsupported: true,
        error: "Hardware o módulo NFC no disponible en este dispositivo.",
      };
    }

    try {
      if (!this.isInitialized) {
        await this.initialize();
      }

      await NfcManager.requestTechnology([NfcTech.Ndef, NfcTech.NfcA]);

      const tag = await NfcManager.getTag();
      if (!tag) {
        return { success: false, error: "Etiqueta no detectada" };
      }

      // Try NDEF payload decoding
      let token = tag.id;
      if (tag.ndefMessage && tag.ndefMessage.length > 0) {
        const payload = tag.ndefMessage[0].payload;
        if (payload) {
          // Parse string payload (skipping language code if present)
          const text = String.fromCharCode(...payload);
          token = text.replace(/^[a-z]{2}/i, "") || tag.id;
        }
      }

      return {
        success: true,
        token: token || tag.id,
      };
    } catch (err: any) {
      return {
        success: false,
        error: err.message || "Error durante el escaneo NFC",
      };
    } finally {
      try {
        await NfcManager.cancelTechnologyRequest();
      } catch {
        // Ignore cancel errors
      }
    }
  },
};
