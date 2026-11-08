// ParkCheck Mobile - Real On-Device Camera Plate Scanner (es-CO)
// Uses expo-camera CameraView + Google ML Kit Text Recognition native bridge
// Specification Reference: Section 1, 2, 3, 5

import React, { useRef, useState } from "react";
import {
  Modal,
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  Platform,
  StatusBar,
} from "react-native";
import { CameraView, useCameraPermissions } from "expo-camera";
import { OcrService, RecognizedPlateResult } from "../services/ocrService";

interface Props {
  visible: boolean;
  intendedMovement?: "ARRIVAL" | "DEPARTURE";
  onClose: () => void;
  onPlateDetected: (result: RecognizedPlateResult) => void;
  onManualFallback?: () => void;
}

export function PlateCameraModal({
  visible,
  intendedMovement,
  onClose,
  onPlateDetected,
  onManualFallback,
}: Props) {
  const [permission, requestPermission] = useCameraPermissions();
  const [torch, setTorch] = useState(false);
  const [processing, setProcessing] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const cameraRef = useRef<any>(null);

  if (!visible) return null;

  const handleCaptureAndScan = async () => {
    if (processing || !cameraRef.current) return;
    setProcessing(true);
    setErrorMessage(null);

    try {
      const photo = await cameraRef.current.takePictureAsync({
        quality: 0.85,
        skipProcessing: false,
      });

      if (!photo?.uri) {
        throw new Error("No se pudo obtener el fotograma de la cámara.");
      }

      // Invoke real Google ML Kit OCR on the captured picture URI
      const ocrResponse = await OcrService.scanPlateFromImage(
        photo.uri,
        intendedMovement
      );

      if (ocrResponse.success && ocrResponse.result) {
        onPlateDetected(ocrResponse.result);
        onClose();
      } else {
        setErrorMessage(
          ocrResponse.error ||
            "No se identificó una placa colombiana válida en la foto. Centre bien la placa con buena luz o ingrésela manualmente."
        );
      }
    } catch (err: any) {
      console.warn("Error en captura u OCR:", err);
      setErrorMessage(
        err?.message ||
          "Error al capturar la imagen. Ingrese la placa manualmente."
      );
    } finally {
      setProcessing(false);
    }
  };

  const handleManualSwitch = () => {
    onClose();
    if (onManualFallback) {
      onManualFallback();
    }
  };

  // Permission handling
  if (!permission || !permission.granted) {
    return (
      <Modal visible={visible} animationType="slide" transparent={false}>
        <View style={styles.permissionContainer}>
          <StatusBar barStyle="light-content" backgroundColor="#0b1329" />
          <Text style={styles.permissionIcon}>📷</Text>
          <Text style={styles.permissionTitle}>Permiso de Cámara Requerido</Text>
          <Text style={styles.permissionDesc}>
            ParkCheck requiere acceso a la cámara para escanear las placas de los
            vehículos mediante reconocimiento óptico local (Google ML Kit).
          </Text>

          <TouchableOpacity
            style={styles.permissionBtn}
            onPress={requestPermission}
            activeOpacity={0.8}
          >
            <Text style={styles.permissionBtnText}>Conceder Permiso</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.manualBtn}
            onPress={handleManualSwitch}
            activeOpacity={0.8}
          >
            <Text style={styles.manualBtnText}>Digitar Placa Manualmente</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.cancelBtn}
            onPress={onClose}
            activeOpacity={0.8}
          >
            <Text style={styles.cancelBtnText}>Cancelar</Text>
          </TouchableOpacity>
        </View>
      </Modal>
    );
  }

  return (
    <Modal
      visible={visible}
      animationType="fade"
      transparent={false}
      onRequestClose={onClose}
    >
      <View style={styles.container}>
        <StatusBar barStyle="light-content" backgroundColor="#000000" />

        {/* Real Live Camera Preview */}
        <CameraView
          ref={cameraRef}
          style={StyleSheet.absoluteFillObject}
          facing="back"
          enableTorch={torch}
        />

        {/* Viewfinder Overlay Mask */}
        <View style={styles.overlay}>
          {/* Top Header Bar */}
          <View style={styles.topBar}>
            <TouchableOpacity
              style={styles.circleBtn}
              onPress={onClose}
              activeOpacity={0.8}
            >
              <Text style={styles.circleBtnText}>✕</Text>
            </TouchableOpacity>

            <View style={styles.headerTitleBox}>
              <Text style={styles.scannerTitle}>Escanear Placa</Text>
              <Text style={styles.scannerSubtitle}>
                Google ML Kit On-Device
              </Text>
            </View>

            <TouchableOpacity
              style={[styles.circleBtn, torch && styles.circleBtnActive]}
              onPress={() => setTorch(!torch)}
              activeOpacity={0.8}
            >
              <Text style={styles.circleBtnText}>{torch ? "🔦" : "💡"}</Text>
            </TouchableOpacity>
          </View>

          {/* Center Target Viewfinder Frame */}
          <View style={styles.centerTarget}>
            <View style={styles.plateGuideBox}>
              <View style={[styles.corner, styles.cornerTL]} />
              <View style={[styles.corner, styles.cornerTR]} />
              <View style={[styles.corner, styles.cornerBL]} />
              <View style={[styles.corner, styles.cornerBR]} />
              <Text style={styles.guideText}>CENTRE LA PLACA AQUÍ</Text>
            </View>
            <Text style={styles.helperText}>
              Mantenga el dispositivo firme frente al vehículo
            </Text>
          </View>

          {/* Action & Feedback Area */}
          <View style={styles.bottomArea}>
            {errorMessage && (
              <View style={styles.errorBox}>
                <Text style={styles.errorTitle}>⚠️ Lectura no concluyente</Text>
                <Text style={styles.errorText}>{errorMessage}</Text>
              </View>
            )}

            {processing ? (
              <View style={styles.processingBox}>
                <ActivityIndicator size="large" color="#38bdf8" />
                <Text style={styles.processingText}>
                  Reconociendo placa con Google ML Kit...
                </Text>
              </View>
            ) : (
              <View style={styles.actionsRow}>
                <TouchableOpacity
                  style={styles.manualEntryBtn}
                  onPress={handleManualSwitch}
                  activeOpacity={0.8}
                >
                  <Text style={styles.manualEntryText}>⌨️ Ingreso Manual</Text>
                </TouchableOpacity>

                <TouchableOpacity
                  style={styles.captureShutterBtn}
                  onPress={handleCaptureAndScan}
                  activeOpacity={0.8}
                >
                  <View style={styles.shutterInnerRing}>
                    <Text style={styles.shutterIcon}>📷</Text>
                  </View>
                </TouchableOpacity>

                <TouchableOpacity
                  style={styles.cancelActionBtn}
                  onPress={onClose}
                  activeOpacity={0.8}
                >
                  <Text style={styles.cancelActionText}>Cerrar</Text>
                </TouchableOpacity>
              </View>
            )}
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#000" },
  overlay: {
    ...StyleSheet.absoluteFillObject,
    justifyContent: "space-between",
  },
  topBar: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingTop: Platform.OS === "android" ? 40 : 54,
    paddingHorizontal: 20,
    paddingBottom: 16,
    backgroundColor: "rgba(0,0,0,0.65)",
  },
  headerTitleBox: { alignItems: "center" },
  scannerTitle: { color: "#f8fafc", fontSize: 18, fontWeight: "bold" },
  scannerSubtitle: { color: "#38bdf8", fontSize: 11, fontWeight: "600" },
  circleBtn: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: "rgba(255,255,255,0.2)",
    justifyContent: "center",
    alignItems: "center",
  },
  circleBtnActive: { backgroundColor: "#f59e0b" },
  circleBtnText: { color: "#fff", fontSize: 18 },
  centerTarget: {
    alignItems: "center",
    justifyContent: "center",
  },
  plateGuideBox: {
    width: 290,
    height: 120,
    borderRadius: 12,
    borderWidth: 2,
    borderColor: "rgba(56, 189, 248, 0.4)",
    backgroundColor: "rgba(15, 23, 42, 0.25)",
    justifyContent: "center",
    alignItems: "center",
    position: "relative",
  },
  guideText: {
    color: "#38bdf8",
    fontSize: 13,
    fontWeight: "bold",
    letterSpacing: 2,
    backgroundColor: "rgba(0,0,0,0.6)",
    paddingHorizontal: 12,
    paddingVertical: 4,
    borderRadius: 4,
  },
  helperText: {
    color: "#e2e8f0",
    fontSize: 12,
    marginTop: 14,
    backgroundColor: "rgba(0,0,0,0.6)",
    paddingHorizontal: 14,
    paddingVertical: 6,
    borderRadius: 16,
  },
  corner: {
    position: "absolute",
    width: 20,
    height: 20,
    borderColor: "#38bdf8",
  },
  cornerTL: { top: -2, left: -2, borderTopWidth: 4, borderLeftWidth: 4, borderTopLeftRadius: 10 },
  cornerTR: { top: -2, right: -2, borderTopWidth: 4, borderRightWidth: 4, borderTopRightRadius: 10 },
  cornerBL: { bottom: -2, left: -2, borderBottomWidth: 4, borderLeftWidth: 4, borderBottomLeftRadius: 10 },
  cornerBR: { bottom: -2, right: -2, borderBottomWidth: 4, borderRightWidth: 4, borderBottomRightRadius: 10 },
  bottomArea: {
    backgroundColor: "rgba(0,0,0,0.75)",
    paddingTop: 16,
    paddingBottom: Platform.OS === "android" ? 28 : 40,
    paddingHorizontal: 20,
  },
  errorBox: {
    backgroundColor: "#450a0a",
    borderColor: "#ef4444",
    borderWidth: 1,
    borderRadius: 8,
    padding: 12,
    marginBottom: 16,
  },
  errorTitle: { color: "#fca5a5", fontSize: 13, fontWeight: "bold" },
  errorText: { color: "#fee2e2", fontSize: 12, marginTop: 4 },
  processingBox: {
    alignItems: "center",
    paddingVertical: 20,
  },
  processingText: {
    color: "#38bdf8",
    fontSize: 14,
    fontWeight: "600",
    marginTop: 10,
  },
  actionsRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  manualEntryBtn: {
    paddingVertical: 12,
    paddingHorizontal: 14,
    backgroundColor: "#1e293b",
    borderRadius: 8,
    borderWidth: 1,
    borderColor: "#475569",
  },
  manualEntryText: { color: "#cbd5e1", fontSize: 13, fontWeight: "600" },
  cancelActionBtn: {
    paddingVertical: 12,
    paddingHorizontal: 16,
  },
  cancelActionText: { color: "#94a3b8", fontSize: 14 },
  captureShutterBtn: {
    width: 76,
    height: 76,
    borderRadius: 38,
    backgroundColor: "rgba(255,255,255,0.3)",
    justifyContent: "center",
    alignItems: "center",
  },
  shutterInnerRing: {
    width: 62,
    height: 62,
    borderRadius: 31,
    backgroundColor: "#38bdf8",
    justifyContent: "center",
    alignItems: "center",
  },
  shutterIcon: { fontSize: 28 },

  // Permission screen styles
  permissionContainer: {
    flex: 1,
    backgroundColor: "#0b1329",
    justifyContent: "center",
    alignItems: "center",
    padding: 24,
  },
  permissionIcon: { fontSize: 56, marginBottom: 16 },
  permissionTitle: { fontSize: 20, fontWeight: "bold", color: "#f8fafc", textAlign: "center" },
  permissionDesc: { fontSize: 14, color: "#94a3b8", textAlign: "center", marginTop: 8, marginBottom: 28, lineHeight: 20 },
  permissionBtn: {
    backgroundColor: "#0284c7",
    paddingVertical: 14,
    paddingHorizontal: 32,
    borderRadius: 10,
    width: "100%",
    alignItems: "center",
    marginBottom: 12,
  },
  permissionBtnText: { color: "#fff", fontSize: 16, fontWeight: "bold" },
  manualBtn: {
    backgroundColor: "#1e293b",
    borderWidth: 1,
    borderColor: "#475569",
    paddingVertical: 14,
    paddingHorizontal: 32,
    borderRadius: 10,
    width: "100%",
    alignItems: "center",
    marginBottom: 12,
  },
  manualBtnText: { color: "#cbd5e1", fontSize: 15, fontWeight: "600" },
  cancelBtn: { paddingVertical: 10 },
  cancelBtnText: { color: "#64748b", fontSize: 14 },
});
