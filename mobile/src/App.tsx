// ParkCheck Mobile - Aplicación Principal (es-CO)
// Workflow: Portería (Movimientos) | Rondas (Inspecciones) | Novedades (Incidentes) | Cola (Sync)

import React, { useState, useEffect } from "react";
import {
  SafeAreaView,
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  StatusBar,
  Alert,
  Platform,
} from "react-native";
import { StorageService } from "./services/storage";
import { AuthSession } from "./types/outbox";
import { LoginScreen } from "./screens/LoginScreen";
import { GateScreen } from "./screens/GateScreen";
import { RondasScreen } from "./screens/RondasScreen";
import { IncidentsScreen } from "./screens/IncidentsScreen";
import { SyncScreen } from "./screens/SyncScreen";

type TabName = "gate" | "rondas" | "incidents" | "sync";

export default function App() {
  const [session, setSession] = useState<AuthSession | null>(null);
  const [activeTab, setActiveTab] = useState<TabName>("gate");
  const [outboxCount, setOutboxCount] = useState(0);

  useEffect(() => {
    // Check persisted auth session on app launch
    StorageService.getSession().then((s) => {
      if (s) setSession(s);
    });

    // Check outbox count
    const interval = setInterval(async () => {
      const items = await StorageService.getOutbox();
      const pending = items.filter(
        (i) => i.syncStatus === "PENDING_SYNC" || i.syncStatus === "SYNC_FAILED"
      ).length;
      setOutboxCount(pending);
    }, 2000);

    return () => clearInterval(interval);
  }, []);

  const handleLogout = async () => {
    const items = await StorageService.getOutbox();
    const pending = items.filter(
      (i) => i.syncStatus === "PENDING_SYNC" || i.syncStatus === "SYNC_FAILED"
    ).length;

    if (pending > 0) {
      Alert.alert(
        "Cierre de Turno",
        `Tiene ${pending} evento(s) guardados localmente en este dispositivo. Permanecerán seguros para el próximo turno. ¿Desea cerrar sesión?`,
        [
          { text: "Cancelar", style: "cancel" },
          {
            text: "Cerrar Turno",
            style: "destructive",
            onPress: async () => {
              await StorageService.setSession(null);
              setSession(null);
            },
          },
        ]
      );
    } else {
      await StorageService.setSession(null);
      setSession(null);
    }
  };

  if (!session) {
    return (
      <SafeAreaView style={styles.safeArea}>
        <StatusBar barStyle="light-content" backgroundColor="#090d16" />
        <LoginScreen onLoginSuccess={setSession} />
      </SafeAreaView>
    );
  }

  const isLocalMode = session.isOfflineMode || session.token.startsWith("offline_");

  return (
    <SafeAreaView style={styles.safeArea}>
      <StatusBar barStyle="light-content" backgroundColor="#090d16" />

      {/* Top Header */}
      <View style={styles.topHeader}>
        <View style={styles.headerInfo}>
          <View style={styles.brandRow}>
            <Text style={styles.headerTitle}>ParkCheck</Text>
            <View
              style={[
                styles.modeTag,
                isLocalMode ? styles.modeTagOffline : styles.modeTagOnline,
              ]}
            >
              <Text style={styles.modeTagText}>
                {isLocalMode ? "TURNO LOCAL" : "EN LÍNEA"}
              </Text>
            </View>
          </View>
          <Text style={styles.headerSubtitle} numberOfLines={1} ellipsizeMode="tail">
            {session.user.name} • {session.user.complexName}
          </Text>
        </View>

        <TouchableOpacity style={styles.logoutBtn} onPress={handleLogout} activeOpacity={0.8}>
          <Text style={styles.logoutText}>Salir</Text>
        </TouchableOpacity>
      </View>

      {/* Offline Outbox Status Banner */}
      {outboxCount > 0 && (
        <TouchableOpacity style={styles.offlineBanner} onPress={() => setActiveTab("sync")}>
          <Text style={styles.bannerText}>
            📶 {isLocalMode ? "Dispositivo Offline" : "En Espera"}: {outboxCount} evento(s) resguardados en cola [Ver]
          </Text>
        </TouchableOpacity>
      )}

      {/* Main Body */}
      <View style={styles.body}>
        {activeTab === "gate" ? (
          <GateScreen session={session} />
        ) : activeTab === "rondas" ? (
          <RondasScreen session={session} />
        ) : activeTab === "incidents" ? (
          <IncidentsScreen session={session} />
        ) : (
          <SyncScreen />
        )}
      </View>

      {/* Bottom Tabs */}
      <View style={styles.navBar}>
        <TouchableOpacity
          style={[styles.tabBtn, activeTab === "gate" && styles.tabActive]}
          onPress={() => setActiveTab("gate")}
          activeOpacity={0.7}
        >
          <Text style={[styles.tabIcon, activeTab === "gate" && styles.tabTextActive]}>🚗</Text>
          <Text style={[styles.tabText, activeTab === "gate" && styles.tabTextActive]}>
            Portería
          </Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.tabBtn, activeTab === "rondas" && styles.tabActive]}
          onPress={() => setActiveTab("rondas")}
          activeOpacity={0.7}
        >
          <Text style={[styles.tabIcon, activeTab === "rondas" && styles.tabTextActive]}>📋</Text>
          <Text style={[styles.tabText, activeTab === "rondas" && styles.tabTextActive]}>
            Rondas
          </Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.tabBtn, activeTab === "incidents" && styles.tabActive]}
          onPress={() => setActiveTab("incidents")}
          activeOpacity={0.7}
        >
          <Text style={[styles.tabIcon, activeTab === "incidents" && styles.tabTextActive]}>⚠️</Text>
          <Text style={[styles.tabText, activeTab === "incidents" && styles.tabTextActive]}>
            Novedades
          </Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.tabBtn, activeTab === "sync" && styles.tabActive]}
          onPress={() => setActiveTab("sync")}
          activeOpacity={0.7}
        >
          <Text style={[styles.tabIcon, activeTab === "sync" && styles.tabTextActive]}>🔄</Text>
          <Text style={[styles.tabText, activeTab === "sync" && styles.tabTextActive]}>
            Cola ({outboxCount})
          </Text>
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: "#090d16",
    paddingTop: Platform.OS === "android" ? (StatusBar.currentHeight || 28) : 0,
  },
  topHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingVertical: 12,
    backgroundColor: "#111827",
    borderBottomWidth: 1,
    borderBottomColor: "#1f2937",
  },
  headerInfo: { flex: 1, marginRight: 12 },
  brandRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  headerTitle: { fontSize: 20, fontWeight: "bold", color: "#38bdf8", letterSpacing: 0.5 },
  modeTag: { paddingHorizontal: 8, paddingVertical: 2, borderRadius: 4 },
  modeTagOffline: { backgroundColor: "#78350f", borderWidth: 1, borderColor: "#d97706" },
  modeTagOnline: { backgroundColor: "#064e3b", borderWidth: 1, borderColor: "#10b981" },
  modeTagText: { color: "#f8fafc", fontSize: 10, fontWeight: "bold" },
  headerSubtitle: { fontSize: 12, color: "#9ca3af", marginTop: 2 },
  logoutBtn: {
    backgroundColor: "#1f2937",
    borderWidth: 1,
    borderColor: "#374151",
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 6,
  },
  logoutText: { color: "#f87171", fontSize: 12, fontWeight: "bold" },
  offlineBanner: {
    backgroundColor: "#854d0e",
    paddingVertical: 7,
    paddingHorizontal: 12,
    alignItems: "center",
  },
  bannerText: { color: "#fef3c7", fontSize: 12, fontWeight: "bold" },
  body: { flex: 1, backgroundColor: "#090d16" },
  navBar: {
    flexDirection: "row",
    backgroundColor: "#111827",
    borderTopWidth: 1,
    borderTopColor: "#1f2937",
    paddingVertical: 6,
  },
  tabBtn: { flex: 1, alignItems: "center", justifyContent: "center", paddingVertical: 6 },
  tabActive: { borderTopWidth: 3, borderTopColor: "#0284c7" },
  tabIcon: { fontSize: 18, marginBottom: 2 },
  tabText: { color: "#9ca3af", fontSize: 12, fontWeight: "600" },
  tabTextActive: { color: "#38bdf8", fontWeight: "bold" },
});
