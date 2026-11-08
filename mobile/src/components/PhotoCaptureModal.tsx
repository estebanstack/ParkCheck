// ParkCheck Mobile - Real Photo Evidence Capture Modal (es-CO)
// Captures authentic photographs of vehicle damage or incidents
// Specification Reference: Section 3, 4, 6

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
  Image,
} from "react-native";
import { CameraView, useCameraPermissions } from "expo-camera";

interface Props {
  visible: boolean;
  title?: string;
  onClose: () => void;
  onPhotoCaptured: (photoUri: string) => void;
}

export function PhotoCaptureModal({
  visible,
  title = "Fotografía de Evidencia",
  onClose,
  onPhotoCaptured,
}: Props) {
  const [permission, requestPermission] = useCameraPermissions();
  const [torch, setTorch] = useState(false);
  const [capturing, setCapturing] = useState(false);
  const [previewUri, setPreviewUri] = useState<string | null>(null);
  const cameraRef = useRef<any>(null);

  if (!visible) return null;

  const handleTakePicture = async () => {
    if (capturing || !cameraRef.current) return;
    setCapturing(true);

    try {
      const photo = await cameraRef.current.takePictureAsync({
        quality: 0.8,
        skipProcessing: false,
      });

      if (photo?.uri) {
        setPreviewUri(photo.uri);
      }
    } catch (err: any) {
      console.warn("Error capturando foto de evidencia:", err);
    } finally {
      setCapturing(false);
    }
  };

  const handleConfirmPhoto = () => {
    if (previewUri) {
      onPhotoCaptured(previewUri);
      setPreviewUri(null);
      onClose();
    }
  };

  const handleRetake = () => {
    setPreviewUri(null);
  };

  const handleModalClose = () => {
    setPreviewUri(null);
    onClose();
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
            Para adjuntar fotografías de evidencia y novedades del vehículo, ParkCheck
            requiere acceso a la cámara.
          </Text>

          <TouchableOpacity
            style={styles.permissionBtn}
            onPress={requestPermission}
            activeOpacity={0.8}
          >
            <Text style={styles.permissionBtnText}>Conceder Permiso</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.cancelBtn}
            onPress={handleModalClose}
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
      onRequestClose={handleModalClose}
    >
      <View style={styles.container}>
        <StatusBar barStyle="light-content" backgroundColor="#000000" />

        {/* If photo was taken, show preview */}
        {previewUri ? (
          <View style={styles.previewContainer}>
            <Image source={{ uri: previewUri }} style={styles.previewImage} />

            <View style={styles.previewOverlay}>
              <View style={styles.previewHeader}>
                <Text style={styles.previewTitle}>Vista Previa de Evidencia</Text>
                <Text style={styles.previewSubtitle}>
                  Verifique que el daño o novedad se aprecie con claridad
                </Text>
              </View>

              <View style={styles.previewActions}>
                <TouchableOpacity
                  style={styles.retakeBtn}
                  onPress={handleRetake}
                  activeOpacity={0.8}
                >
                  <Text style={styles.retakeText}>🔄 Repetir Foto</Text>
                </TouchableOpacity>

                <TouchableOpacity
                  style={styles.usePhotoBtn}
                  onPress={handleConfirmPhoto}
                  activeOpacity={0.8}
                >
                  <Text style={styles.usePhotoText}>✓ Usar esta Foto</Text>
                </TouchableOpacity>
              </View>
            </View>
          </View>
        ) : (
          <>
            {/* Live Camera View */}
            <CameraView
              ref={cameraRef}
              style={StyleSheet.absoluteFillObject}
              facing="back"
              enableTorch={torch}
            />

            {/* Controls Overlay */}
            <View style={styles.overlay}>
              <View style={styles.topBar}>
                <TouchableOpacity
                  style={styles.circleBtn}
                  onPress={handleModalClose}
                  activeOpacity={0.8}
                >
                  <Text style={styles.circleBtnText}>✕</Text>
                </TouchableOpacity>

                <Text style={styles.topTitle}>{title}</Text>

                <TouchableOpacity
                  style={[styles.circleBtn, torch && styles.circleBtnActive]}
                  onPress={() => setTorch(!torch)}
                  activeOpacity={0.8}
                >
                  <Text style={styles.circleBtnText}>{torch ? "🔦" : "💡"}</Text>
                </TouchableOpacity>
              </View>

              <View style={styles.bottomArea}>
                <Text style={styles.instructionText}>
                  Enfoque el área afectada con buena luz y tome la foto
                </Text>

                <View style={styles.shutterRow}>
                  <TouchableOpacity
                    style={styles.cancelTextBtn}
                    onPress={handleModalClose}
                    activeOpacity={0.8}
                  >
                    <Text style={styles.cancelText}>Cancelar</Text>
                  </TouchableOpacity>

                  <TouchableOpacity
                    style={styles.shutterBtn}
                    onPress={handleTakePicture}
                    disabled={capturing}
                    activeOpacity={0.8}
                  >
                    {capturing ? (
                      <ActivityIndicator color="#0284c7" />
                    ) : (
                      <View style={styles.shutterInner} />
                    )}
                  </TouchableOpacity>

                  <View style={{ width: 60 }} />
                </View>
              </View>
            </View>
          </>
        )}
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
    backgroundColor: "rgba(0,0,0,0.6)",
  },
  topTitle: { color: "#f8fafc", fontSize: 16, fontWeight: "bold" },
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
  bottomArea: {
    backgroundColor: "rgba(0,0,0,0.75)",
    paddingTop: 16,
    paddingBottom: Platform.OS === "android" ? 28 : 40,
    paddingHorizontal: 20,
    alignItems: "center",
  },
  instructionText: {
    color: "#cbd5e1",
    fontSize: 13,
    marginBottom: 20,
    textAlign: "center",
  },
  shutterRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    width: "100%",
  },
  cancelTextBtn: { width: 60 },
  cancelText: { color: "#94a3b8", fontSize: 14 },
  shutterBtn: {
    width: 76,
    height: 76,
    borderRadius: 38,
    borderWidth: 4,
    borderColor: "#ffffff",
    justifyContent: "center",
    alignItems: "center",
  },
  shutterInner: {
    width: 60,
    height: 60,
    borderRadius: 30,
    backgroundColor: "#ffffff",
  },

  // Preview styles
  previewContainer: { flex: 1, backgroundColor: "#000" },
  previewImage: { ...StyleSheet.absoluteFillObject, resizeMode: "cover" },
  previewOverlay: {
    ...StyleSheet.absoluteFillObject,
    justifyContent: "space-between",
    backgroundColor: "rgba(0,0,0,0.3)",
  },
  previewHeader: {
    paddingTop: Platform.OS === "android" ? 44 : 58,
    paddingHorizontal: 20,
    paddingBottom: 14,
    backgroundColor: "rgba(0,0,0,0.7)",
  },
  previewTitle: { color: "#f8fafc", fontSize: 18, fontWeight: "bold" },
  previewSubtitle: { color: "#94a3b8", fontSize: 12, marginTop: 4 },
  previewActions: {
    flexDirection: "row",
    gap: 12,
    padding: 20,
    paddingBottom: Platform.OS === "android" ? 30 : 44,
    backgroundColor: "rgba(0,0,0,0.8)",
  },
  retakeBtn: {
    flex: 1,
    backgroundColor: "#1e293b",
    borderWidth: 1,
    borderColor: "#475569",
    paddingVertical: 14,
    borderRadius: 10,
    alignItems: "center",
  },
  retakeText: { color: "#cbd5e1", fontSize: 14, fontWeight: "600" },
  usePhotoBtn: {
    flex: 1,
    backgroundColor: "#059669",
    paddingVertical: 14,
    borderRadius: 10,
    alignItems: "center",
  },
  usePhotoText: { color: "#ffffff", fontSize: 14, fontWeight: "bold" },

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
  cancelBtn: { paddingVertical: 10 },
  cancelBtnText: { color: "#64748b", fontSize: 14 },
});
