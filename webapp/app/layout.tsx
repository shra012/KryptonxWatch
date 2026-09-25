import type { Metadata } from "next";
import { EB_Garamond, JetBrains_Mono } from "next/font/google";
import "./globals.css";
import { AppProvider } from "@/components/app-provider";
import { Shell } from "@/components/shell";
const serif = EB_Garamond({ subsets: ["latin"], variable: "--font-serif", display: "swap", fallback: ["Georgia", "Times New Roman", "serif"] });
const mono = JetBrains_Mono({ subsets: ["latin"], variable: "--font-mono", display: "swap", fallback: ["ui-monospace", "monospace"] });
export const metadata: Metadata = { title: "KryptonxWatch", description: "Edge video security review workspace" };
export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en" suppressHydrationWarning className={`${serif.variable} ${mono.variable}`}><body><AppProvider><Shell>{children}</Shell></AppProvider></body></html>;
}
