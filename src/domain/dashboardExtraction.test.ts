// ParkCheck - Phase 4, Stage B: Shared Dashboard Shell Extraction Verification Tests
import { describe, it, expect } from "vitest";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { RoleBadge } from "@/components/common/RoleBadge";
import {
  IncidentStatusBadge,
  getIncidentStatusBadgeConfig,
} from "@/components/common/IncidentStatusBadge";
import { DashboardHeader } from "@/components/dashboard/DashboardHeader";
import { DashboardNavigation } from "@/components/dashboard/DashboardNavigation";
import { DashboardShell } from "@/components/dashboard/DashboardShell";
import { DashboardTab } from "@/types/dashboard";
import { SessionPayload } from "@/domain/auth";

describe("Phase 4 Stage B: Shared Dashboard Shell Extraction", () => {
  describe("RoleBadge Component", () => {
    it("renders each of the 5 canonical roles with appropriate styling and text", () => {
      const roles = [
        { role: "ENTRANCE_GUARD", expectedText: "Guarda de Portería", colorClass: "text-blue-300" },
        { role: "PARKING_GUARD", expectedText: "Guarda Rondero", colorClass: "text-purple-300" },
        { role: "SUPERVISOR", expectedText: "Supervisor de Seguridad", colorClass: "text-amber-300" },
        { role: "RESIDENTIAL_ADMIN", expectedText: "Administración", colorClass: "text-emerald-300" },
        { role: "PLATFORM_ADMIN", expectedText: "Super Admin Plataforma", colorClass: "text-rose-300" },
      ];

      for (const { role, expectedText, colorClass } of roles) {
        const html = renderToStaticMarkup(React.createElement(RoleBadge, { role }));
        expect(html).toContain(expectedText);
        expect(html).toContain(colorClass);
      }
    });

    it("renders fallback for unknown role", () => {
      const html = renderToStaticMarkup(React.createElement(RoleBadge, { role: "CUSTOM_ROLE" }));
      expect(html).toContain("CUSTOM_ROLE");
      expect(html).toContain("bg-slate-800");
    });
  });

  describe("IncidentStatusBadge Component & Config", () => {
    const statuses = [
      { status: "REPORTED", label: "Reportado" },
      { status: "AWAITING_REVIEW", label: "En Revisión" },
      { status: "UNDER_INVESTIGATION", label: "En Investigación" },
      { status: "OWNER_CONTACT_PENDING", label: "Contacto Pendiente" },
      { status: "OWNER_CONTACTED", label: "Propietario Contactado" },
      { status: "RESOLVED", label: "Resuelto" },
      { status: "CLOSED", label: "Cerrado y Archivado" },
    ];

    it("maps all 7 incident lifecycle statuses correctly", () => {
      for (const { status, label } of statuses) {
        const config = getIncidentStatusBadgeConfig(status);
        expect(config.label).toBe(label);

        const htmlSm = renderToStaticMarkup(
          React.createElement(IncidentStatusBadge, { status, size: "sm" })
        );
        expect(htmlSm).toContain(label);
        expect(htmlSm).toContain("text-[10px]");

        const htmlMd = renderToStaticMarkup(
          React.createElement(IncidentStatusBadge, { status, size: "md" })
        );
        expect(htmlMd).toContain(label);
        expect(htmlMd).toContain("text-xs");
      }
    });

    it("handles unrecognized statuses gracefully", () => {
      const config = getIncidentStatusBadgeConfig("UNKNOWN_STATE");
      expect(config.label).toBe("UNKNOWN_STATE");
      expect(config.bg).toContain("bg-slate-800");
    });
  });

  describe("DashboardHeader Component", () => {
    const mockUser: SessionPayload = {
      userId: "usr-001",
      email: "guard@parkcheck.test",
      name: "Juan Pérez",
      role: "ENTRANCE_GUARD",
      complexId: "complex-1234567890abcdef",
    };

    it("renders user information, complex id slice, role badge, and logout button", () => {
      const html = renderToStaticMarkup(
        React.createElement(DashboardHeader, {
          user: mockUser,
          onLogout: () => {},
        })
      );

      expect(html).toContain("Juan Pérez");
      expect(html).toContain("complex-1234");
      expect(html).toContain("Guarda de Portería");
      expect(html).toContain("ParkCheck");
      expect(html).toContain("FASE 2 REAL");
      expect(html).toContain("Salir");
    });
  });

  describe("DashboardNavigation Component", () => {
    it("preserves all 7 tab identifiers and renders their labels", () => {
      const activeTab: DashboardTab = "gate";
      const html = renderToStaticMarkup(
        React.createElement(DashboardNavigation, {
          activeTab,
          onTabChange: () => {},
          queueCount: 5,
          hasUrgentQueue: true,
          incidentsCount: 3,
        })
      );

      expect(html).toContain("Portería");
      expect(html).toContain("Rondas (5)");
      expect(html).toContain("Inspección");
      expect(html).toContain("Incidentes (3)");
      expect(html).toContain("Vehículos");
      expect(html).toContain("Métricas");
      expect(html).toContain("Reportes CSV");

      // Urgent priority indicator pulse
      expect(html).toContain("animate-pulse");
    });

    it("applies active styles to the selected tab", () => {
      const html = renderToStaticMarkup(
        React.createElement(DashboardNavigation, {
          activeTab: "queue",
          onTabChange: () => {},
          queueCount: 2,
        })
      );

      expect(html).toContain("bg-emerald-600 text-white shadow");
    });
  });

  describe("DashboardShell Component", () => {
    it("renders header, navigation, and children within the shared container structure", () => {
      const html = renderToStaticMarkup(
        React.createElement(
          DashboardShell,
          {
            header: React.createElement("div", { id: "test-header" }, "Header Content"),
            navigation: React.createElement("div", { id: "test-nav" }, "Nav Content"),
          },
          React.createElement("div", { id: "test-body" }, "Tab Body Content")
        )
      );

      expect(html).toContain("Header Content");
      expect(html).toContain("Nav Content");
      expect(html).toContain("Tab Body Content");
      expect(html).toContain("min-h-screen bg-slate-950 text-slate-100");
      expect(html).toContain("max-w-7xl mx-auto w-full");
    });
  });
});
