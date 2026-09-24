import type { Metadata } from "next";
import "./globals.css";
import { AppProvider } from "@/components/app-provider";
import { Shell } from "@/components/shell";
export const metadata: Metadata = { title: "KryptonxWatch", description: "Recorded video security review dashboard" };
export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en" suppressHydrationWarning><body><AppProvider><Shell>{children}</Shell></AppProvider></body></html>;
}
