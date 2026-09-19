import type { Metadata } from "next";
import { headers } from "next/headers";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { Toaster } from "@/components/ui/toaster";
import { Toaster as SonnerToaster } from "@/components/ui/sonner";
import { ThemeProvider } from "next-themes";
import { RealtimeProvider } from "@/components/diamond/realtime-provider";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Diamond Manufacturing ERP — Analysis · Requirement · Planning · Traceability",
  description: "Enterprise diamond manufacturing analysis, sales intelligence, demand & requirement engine, rough planning, manufacturing traceability, plan-vs-actual and data science platform.",
  keywords: ["diamond", "manufacturing", "ERP", "planning", "traceability", "requirement", "yield"],
  authors: [{ name: "Fantasy Diamond Holdings" }],
  icons: {
    icon: "/logo.svg",
  },
};

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  // Reading the per-request nonce makes the page dynamic, which the nonce-based CSP requires.
  const nonce = (await headers()).get("x-nonce") ?? undefined;
  return (
    <html lang="en" suppressHydrationWarning>
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased bg-background text-foreground`}
      >
        <ThemeProvider attribute="class" defaultTheme="light" enableSystem={false} nonce={nonce}>
          <RealtimeProvider>{children}</RealtimeProvider>
        </ThemeProvider>
        <Toaster />
        <SonnerToaster position="top-right" richColors closeButton />
      </body>
    </html>
  );
}
