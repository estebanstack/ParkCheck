# Guía de Despliegue en Staging y Validación en Dispositivo Físico — ParkCheck

Este documento establece el procedimiento estándar, seguro y reproducible para desplegar ParkCheck en el entorno de staging (preproducción) y llevar a cabo las pruebas de aceptación con guardas en dispositivos físicos Android.

---

## 1. Requisitos de Infraestructura y Secretos

### 1.1 Base de Datos PostgreSQL Dedicada
- **Instancia**: Base de datos PostgreSQL v15+ exclusiva para Staging (`parkcheck_staging`).
- **Aislamiento**: Totalmente segregada de entornos de producción y bases personales de desarrolladores.
- **SSL**: Habilitado (`sslmode=require` o `sslmode=prefer`).
- **Respaldo Previo**: Ejecutar un snapshot o dump antes de cualquier migración:
  ```bash
  pg_dump -h <HOST_STAGING> -U parkcheck_staging -d parkcheck_staging -Fc -f backup_pre_migration_$(date +%Y%m%d_%H%M%S).dump
  ```

### 1.2 Políticas de Migración
- **PROHIBIDO**: El uso de `prisma db push` o comandos destructivos (`prisma migrate reset`) en el entorno de staging.
- **APLICACIÓN**:
  1. Revisar `prisma/schema.prisma` y los archivos SQL generados.
  2. Ejecutar `npx prisma migrate deploy` para aplicar únicamente migraciones controladas e inmutables.
  3. Ejecutar `npm run seed` únicamente si se requiere poblar el conjunto piloto inicial.

### 1.3 Almacenamiento Durable de Evidencia Fotográfica
- **Contenedores sin estado / Kubernetes**: Configurar `STORAGE_DRIVER="s3"` con bucket dedicado `parkcheck-staging-attachments`.
- **Despliegue en VM / Docker con volumen**: Configurar `STORAGE_DRIVER="local"` montando un Persistent Volume Claim (PVC) en `./uploads`.

---

## 2. Ejecución de Pruebas de Integración PostgreSQL

Cuando las credenciales de staging (`DATABASE_URL`) estén configuradas en las variables de entorno:

```bash
DATABASE_URL="postgresql://parkcheck_staging:<PASSWORD>@<HOST>:5432/parkcheck_staging?schema=public" npx vitest run src/domain/postgresIntegration.test.ts
```

La suite ejecutará los siguientes 5 escenarios con base de datos real:
1. **Unicidad de placas por conjunto**: Restricción `@@unique([complexId, plate])`.
2. **Idempotencia de eventos de sincronización**: Restricción `@@unique([complexId, clientEventId])`.
3. **Rollback atómico**: Deshacer transacciones multi-paso ante errores inesperados.
4. **Aislamiento multi-tenancy**: Consultas del Conjunto A no exponen registros del Conjunto B.
5. **Persistencia y enlace relacional**: Ciclo de vida completo (Movimiento -> Tarea de inspección de retorno -> Incidente -> Log de auditoría).

---

## 3. Instalación de la Aplicación Android

### 3.1 Artefacto Generado
- **Ruta del APK**: `mobile/android/app/build/outputs/apk/debug/app-debug.apk`
- **Tamaño**: ~169 MB (incluye arquitectura ARM64/ARMv7/x86, motor Hermes, Google ML Kit OCR nativo y módulos Expo 54).

### 3.2 Instalación vía ADB en Dispositivo Físico
1. Conectar el dispositivo por USB o WiFi ADB:
   ```bash
   adb devices
   ```
2. Instalar el paquete APK en el dispositivo:
   ```bash
   adb install -r mobile/android/app/build/outputs/apk/debug/app-debug.apk
   ```
3. Configurar reenvío de puertos para conectar al servidor local o staging si se prueba en red local:
   ```bash
   adb reverse tcp:3000 tcp:3000
   ```
4. Conceder permisos de cámara:
   ```bash
   adb shell pm grant com.parkcheck.guard android.permission.CAMERA
   ```
5. Iniciar la aplicación:
   ```bash
   adb shell am start -n com.parkcheck.guard/.MainActivity
   ```

---

## 4. Protocolo de Validación en Dispositivo Físico (Checklist de Campo)

Para certificar la salida a piloto controlado, el operador o guarda de seguridad debe ejecutar físicamente las siguientes 10 verificaciones:

1. [ ] **Inicio de Sesión**: Ingresar credenciales autorizadas (`porteria@bosquereal.com`) y verificar descarga automática del manifiesto de vehículos.
2. [ ] **Registro de Vehículo**: Registrar un nuevo vehículo con placa colombiana (`KHY842` / `XYZ987`) y puesto de estacionamiento asignado.
3. [ ] **Captura de Cámara y OCR**: Apuntar la cámara del dispositivo hacia la placa física de un automóvil o motocicleta.
4. [ ] **Confirmación de Placa**: Validar que el OCR identifique el formato `ABC123` y seleccione el vehículo del manifiesto local.
5. [ ] **Búsqueda Manual Alternativa**: Probar la búsqueda por texto cuando la placa esté sucia o deteriorada.
6. [ ] **Registro de Movimiento (Entrada/Salida)**: Registrar ingreso y salida del vehículo.
7. [ ] **Inspección de Retorno**: Verificar que el reingreso genere una tarea de inspección obligatoria prioritaria en la cola de trabajo.
8. [ ] **Advertencias de Estado**: Validar que un vehículo marcado `INSIDE` que intente volver a entrar genere alerta de presencia contradictoria.
9. [ ] **Persistencia de Outbox**: Registrar un movimiento en modo avión, forzar el cierre de la aplicación (`am force-stop`), reiniciar y comprobar que el evento permanece en la bandeja de salida.
10. [ ] **Sincronización Offline**: Reconectar la red (desactivar modo avión) y confirmar sincronización por lotes (`syncBatch`) sin duplicidad en el servidor.
