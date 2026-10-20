// ParkCheck - Prisma Seed Script
// Creates sample residential complex, users for all roles, registered vehicles, and realistic state

import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";

const prisma = new PrismaClient();

async function main() {
  console.log("Seeding ParkCheck database...");

  // 1. Create Residential Complex (Conjunto Residencial)
  const complex = await prisma.residentialComplex.upsert({
    where: { code: "BOSQUE-REAL-01" },
    update: {},
    create: {
      name: "Conjunto Residencial Bosque Real",
      code: "BOSQUE-REAL-01",
      address: "Calle 140 # 19-35",
      city: "Bogotá",
      country: "Colombia",
      inspectionIntervalMinutes: 60,
      overdueGraceMinutes: 15,
      returnSatisfiesScheduledPolicy: "NEVER",
      returnWindowMinutes: 30,
      departureWithPendingTaskPolicy: "FLAG_FOR_SUPERVISOR_REVIEW",
      queueAlertOrderPolicy: "RETURN_FIRST_ALERTS_PINNED",
      overdueEscalationMinutes: 30,
      movementDedupSeconds: 60,
      retentionDaysPhotos: 365,
      retentionDaysRecords: 365,
    },
  });

  console.log(`Created/found Complex: ${complex.name} (${complex.id})`);

  // 2. Create Users for all roles (password: 'ParkCheck2026*')
  const defaultPasswordHash = await bcrypt.hash("ParkCheck2026*", 10);

  const usersData = [
    {
      email: "porteria@bosquereal.com",
      name: "Carlos Mendoza (Guarda Entrada)",
      role: "ENTRANCE_GUARD" as const,
    },
    {
      email: "rondas@bosquereal.com",
      name: "Jhonatan Pérez (Guarda Rondero)",
      role: "PARKING_GUARD" as const,
    },
    {
      email: "supervisor@seguridadcolombia.com",
      name: "Mayor (R) Luis Restrepo (Supervisor)",
      role: "SUPERVISOR" as const,
    },
    {
      email: "administracion@bosquereal.com",
      name: "Dra. Martha Gómez (Administradora)",
      role: "RESIDENTIAL_ADMIN" as const,
    },
    {
      email: "admin@parkcheck.app",
      name: "Super Admin (Plataforma)",
      role: "PLATFORM_ADMIN" as const,
    },
  ];

  for (const u of usersData) {
    const user = await prisma.user.upsert({
      where: { email: u.email },
      update: {},
      create: {
        email: u.email,
        name: u.name,
        passwordHash: defaultPasswordHash,
      },
    });

    await prisma.userSiteRole.upsert({
      where: {
        userId_complexId_role: {
          userId: user.id,
          complexId: complex.id,
          role: u.role,
        },
      },
      update: {},
      create: {
        userId: user.id,
        complexId: complex.id,
        role: u.role,
      },
    });

    console.log(`Registered user: ${u.name} [${u.role}]`);
  }

  // 3. Register Vehicles
  const vehiclesData = [
    { plate: "KHY842", space: "Torre 1 - Parqueadero 102", stickerToken: "NFC-PC-KHY842", status: "INSIDE" as const },
    { plate: "WLU915", space: "Torre 2 - Parqueadero 205", stickerToken: "NFC-PC-WLU915", status: "INSIDE" as const },
    { plate: "UVR330", space: "Torre 1 - Parqueadero 110", stickerToken: "NFC-PC-UVR330", status: "AWAY" as const },
    { plate: "FTZ654", space: "Torre 3 - Parqueadero 301", stickerToken: "NFC-PC-FTZ654", status: "UNCERTAIN" as const },
  ];

  for (const v of vehiclesData) {
    const vehicle = await prisma.vehicle.upsert({
      where: {
        complexId_plate: {
          complexId: complex.id,
          plate: v.plate,
        },
      },
      update: {},
      create: {
        complexId: complex.id,
        plate: v.plate,
        parkingSpace: v.space,
        stickerToken: v.stickerToken,
      },
    });

    await prisma.vehiclePresence.upsert({
      where: { vehicleId: vehicle.id },
      update: {},
      create: {
        vehicleId: vehicle.id,
        currentStatus: v.status,
        verificationDetails: v.status === "UNCERTAIN" ? "Placa borrosa en cámara de acceso norte" : null,
      },
    });

    console.log(`Registered vehicle: ${v.plate} -> Presence: ${v.status}`);
  }

  console.log("Database seed completed successfully.");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
