// ParkCheck Mobile - Pantalla de Inicio de Sesión (es-CO)
import React, { useState } from "react";
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  Alert,
} from "react-native";
import { ApiClient, getApiBaseUrl, setApiBaseUrl } from "../services/api";
import { StorageService } from "../services/storage";
import { AuthSession } from "../types/outbox";

interface Props {
  onLoginSuccess: (session: AuthSession) => void;
}

export function LoginScreen({ onLoginSuccess }: Props) {
  const [email, setEmail] = useState("porteria@bosquereal.com");
  const [password, setPassword] = useState("ParkCheck2026*");
  const [serverUrl, setServerUrl] = useState(getApiBaseUrl());
  const [showServerConfig, setShowServerConfig] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleLogin = async () => {
    if (!email || !password) {
      setError("Por favor ingrese correo y contraseña");
      return;
    }

    if (serverUrl) {
      setApiBaseUrl(serverUrl);
    }

    setLoading(true);
    setError(null);

    try {
      const res = await ApiClient.login(email.trim(), password);
      const session: AuthSession = {
        token: res.token,
        user: res.user,
      };

      await StorageService.setSession(session);

      // Attempt initial manifest download
      try {
        const manifest = await ApiClient.fetchManifest(session.token);
        if (manifest?.vehicles) {
          await StorageService.setCachedVehicles(manifest.vehicles);
        }
      } catch (manifestErr) {
        console.warn("Manifiesto inicial no descargado (posible offline):", manifestErr);
      }

      onLoginSuccess(session);
    } catch (err: any) {
      setError(err.message || "Error al autenticar");
    } finally {
      setLoading(false);
    }
  };

  const handleOfflineLogin = async () => {
    const offlineSession: AuthSession = {
      token: "offline_local_turn_" + Date.now(),
      isOfflineMode: true,
      user: {
        id: "guard_offline_01",
        email: email.trim() || "porteria@bosquereal.com",
        name: "Guarda Esteban Castro",
        role: "ENTRANCE_GUARD",
        complexId: "cly_demo_complex_01",
        complexName: "Conjunto Residencial Bosque Real",
      },
    };
    await StorageService.setSession(offlineSession);
    const existingVehicles = await StorageService.getCachedVehicles();
    if (existingVehicles.length === 0) {
      await StorageService.setCachedVehicles([
        {
          id: "veh_01",
          complexId: "cly_demo_complex_01",
          plate: "KHY842",
          presenceStatus: "AWAY",
          parkingSpace: "Torre 1 - P102",
          make: "Mazda",
          model: "CX-30",
          color: "Rojo",
          activeTasks: [],
        },
        {
          id: "veh_02",
          complexId: "cly_demo_complex_01",
          plate: "WLU915",
          presenceStatus: "INSIDE",
          parkingSpace: "Torre 2 - P205",
          make: "Toyota",
          model: "Corolla",
          color: "Gris",
          activeTasks: [
            {
              id: "task_init_wlu",
              triggerType: "SCHEDULED",
              status: "PENDING",
              dueAt: new Date(Date.now() + 45 * 60 * 1000).toISOString(),
              description: "Ronda programada rutinaria",
            },
          ],
        },
        {
          id: "veh_03",
          complexId: "cly_demo_complex_01",
          plate: "FTZ654",
          presenceStatus: "INSIDE",
          parkingSpace: "Torre 3 - P301",
          make: "Chevrolet",
          model: "Onix",
          color: "Blanco",
          activeTasks: [
            {
              id: "task_init_ftz",
              triggerType: "SCHEDULED",
              status: "OVERDUE",
              dueAt: new Date(Date.now() - 20 * 60 * 1000).toISOString(),
              description: "Ronda programada - Vencida",
            },
          ],
        },
      ]);
    }
    onLoginSuccess(offlineSession);
  };

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.brand}>ParkCheck</Text>
        <Text style={styles.subtitle}>Control de Seguridad y Acceso Vehicular</Text>
      </View>

      <View style={styles.card}>
        <Text style={styles.cardTitle}>Acceso de Guardas</Text>

        {error && <Text style={styles.errorText}>{error}</Text>}

        <Text style={styles.label}>Correo Electrónico</Text>
        <TextInput
          style={styles.input}
          value={email}
          onChangeText={setEmail}
          placeholder="guarda@conjunto.com"
          keyboardType="email-address"
          autoCapitalize="none"
        />

        <Text style={styles.label}>Contraseña</Text>
        <TextInput
          style={styles.input}
          value={password}
          onChangeText={setPassword}
          placeholder="••••••••"
          secureTextEntry
        />

        <TouchableOpacity
          onPress={() => setShowServerConfig(!showServerConfig)}
          style={{ marginTop: 12 }}
        >
          <Text style={{ color: "#38bdf8", fontSize: 12 }}>
            {showServerConfig ? "▲ Ocultar opciones de servidor" : "▼ Configurar servidor API"}
          </Text>
        </TouchableOpacity>

        {showServerConfig && (
          <View style={{ marginTop: 8 }}>
            <Text style={styles.label}>URL Servidor (Staging / Local)</Text>
            <TextInput
              style={styles.input}
              value={serverUrl}
              onChangeText={setServerUrl}
              placeholder="http://127.0.0.1:3000"
              autoCapitalize="none"
              autoCorrect={false}
            />
          </View>
        )}

        <TouchableOpacity
          style={[styles.button, loading && styles.buttonDisabled]}
          onPress={handleLogin}
          disabled={loading}
        >
          {loading ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <Text style={styles.buttonText}>Iniciar Turno</Text>
          )}
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.button, styles.offlineButton]}
          onPress={handleOfflineLogin}
          activeOpacity={0.8}
        >
          <Text style={styles.offlineButtonText}>📱 Iniciar Turno Local (Offline)</Text>
        </TouchableOpacity>

        <Text style={styles.offlineNotice}>
          El turno local opera con almacenamiento autónomo en el dispositivo sin requerir conexión continua al servidor.
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#0b1329",
    justifyContent: "center",
    padding: 20,
  },
  header: {
    alignItems: "center",
    marginBottom: 24,
  },
  brand: {
    fontSize: 34,
    fontWeight: "bold",
    color: "#38bdf8",
    letterSpacing: 1,
  },
  subtitle: {
    fontSize: 14,
    color: "#94a3b8",
    marginTop: 6,
    textAlign: "center",
  },
  card: {
    backgroundColor: "#131b2e",
    borderRadius: 16,
    padding: 22,
    borderWidth: 1,
    borderColor: "#1e293b",
  },
  cardTitle: {
    fontSize: 18,
    fontWeight: "bold",
    color: "#f8fafc",
    marginBottom: 16,
    textAlign: "center",
  },
  label: {
    fontSize: 13,
    color: "#cbd5e1",
    marginBottom: 6,
    marginTop: 10,
    fontWeight: "500",
  },
  input: {
    backgroundColor: "#0b1329",
    borderWidth: 1,
    borderColor: "#334155",
    borderRadius: 10,
    padding: 12,
    color: "#f8fafc",
    fontSize: 15,
  },
  button: {
    backgroundColor: "#0284c7",
    paddingVertical: 14,
    borderRadius: 10,
    alignItems: "center",
    marginTop: 20,
  },
  buttonDisabled: {
    opacity: 0.6,
  },
  buttonText: {
    color: "#fff",
    fontSize: 16,
    fontWeight: "bold",
  },
  offlineButton: {
    backgroundColor: "#1e293b",
    borderWidth: 1,
    borderColor: "#475569",
    marginTop: 10,
  },
  offlineButtonText: {
    color: "#38bdf8",
    fontSize: 14,
    fontWeight: "bold",
  },
  offlineNotice: {
    color: "#64748b",
    fontSize: 11,
    textAlign: "center",
    marginTop: 10,
    lineHeight: 15,
  },
  errorText: {
    color: "#f87171",
    backgroundColor: "#450a0a",
    padding: 10,
    borderRadius: 8,
    marginBottom: 10,
    fontSize: 13,
  },
});

