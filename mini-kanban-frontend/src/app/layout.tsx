import type { Metadata } from "next";
import { Archivo, Courier_Prime } from "next/font/google";
import "./globals.css";
import { Providers } from "./providers";

/**
 * DESIGN §3 — exactly two families, through next/font/google, never a <link>
 * tag and never a third family. next/font self-hosts and preloads them, so
 * there is no render-blocking request to fonts.googleapis.com at run time.
 */
const archivo = Archivo({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  display: "swap",
  variable: "--font-archivo",
});

const courier = Courier_Prime({
  subsets: ["latin"],
  weight: ["400", "700"],
  display: "swap",
  variable: "--font-courier",
});

export const metadata: Metadata = {
  title: "Mini Kanban",
  description: "A filing-room Kanban board — boards, columns and index cards.",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className={`${archivo.variable} ${courier.variable}`}>
      <body className="min-h-screen antialiased">
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
