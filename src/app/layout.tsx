import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "ParkCheck — Control de Inspección Vehicular",
  description: "Plataforma de inspección vehicular y gestión de incidentes para conjuntos residenciales",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="es">
      <body className="min-h-screen bg-slate-900 text-slate-100 antialiased font-sans">
        {children}
      </body>
    </html>
  );
}
