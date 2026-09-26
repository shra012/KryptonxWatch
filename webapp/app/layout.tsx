import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { AppProvider } from "@/components/app-provider";
import { Shell } from "@/components/shell";
import { CallCenterProvider } from "@/components/call-center";
import { ExcludedCleanup } from "@/components/excluded-cleanup";
const sans = Geist({ subsets: ["latin"], variable: "--font-geist", display: "swap" });
const mono = Geist_Mono({ subsets: ["latin"], variable: "--font-geist-mono", display: "swap" });
export const metadata: Metadata = { title: "Sentinel Machines", description: "Edge video security review workspace" };
export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en" suppressHydrationWarning className={`${sans.variable} ${mono.variable} antialiased`}><body><AppProvider><CallCenterProvider><ExcludedCleanup/><Shell>{children}</Shell></CallCenterProvider></AppProvider></body></html>;
}
