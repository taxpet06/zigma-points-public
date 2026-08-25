import type { Metadata, Viewport } from "next";
import { Suspense } from "react";
import { Inter, JetBrains_Mono } from "next/font/google";
import "./globals.css";
import { Providers } from "@/components/providers";
import { Header } from "@/components/nav/header";
import { BottomBar } from "@/components/nav/bottom-bar";
import { NextSSRPlugin } from "@uploadthing/react/next-ssr-plugin";
import { extractRouterConfig } from "uploadthing/server";
import { ourFileRouter } from "@/app/api/uploadthing/core";
import { Toaster } from "@/components/ui/sonner";
import { IosInstallNudge } from "@/components/push/ios-install-nudge";
import { ServiceWorkerRegistrar } from "@/components/push/sw-register";
import { AppBackdrop } from "@/components/app-backdrop";

const inter = Inter({
  variable: "--font-sans",
  subsets: ["latin"],
});

const jetbrainsMono = JetBrains_Mono({
  variable: "--font-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Zigma Points",
  description: "Community-driven points and recognition platform",
  appleWebApp: {
    capable: true,
    title: "Zigma Points",
    statusBarStyle: "default",
  },
  // Next 16's `appleWebApp.capable` emits only the standardized
  // <meta name="mobile-web-app-capable"> (Chrome deprecated the apple- name), but
  // iOS Safari still honors ONLY <meta name="apple-mobile-web-app-capable"> for
  // standalone display on iOS < 16.4 — without it "Add to Home Screen" installs a
  // plain Safari bookmark (opens with browser chrome) instead of a real standalone
  // app. Re-add it explicitly here. No effect on Android. This was THE iOS install bug.
  other: { "apple-mobile-web-app-capable": "yes" },
};

export const viewport: Viewport = {
  viewportFit: "cover",
  // Shrink the layout viewport (and dvh units) when the on-screen keyboard opens
  // so dialogs/forms stay scrollable and their fields/buttons remain reachable.
  interactiveWidget: "resizes-content",
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#ffffff" },
    { media: "(prefers-color-scheme: dark)", color: "#141212" },
  ],
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${inter.variable} ${jetbrainsMono.variable} h-full antialiased`}
      suppressHydrationWarning
    >
      <body className="min-h-full flex flex-col">
        <div className="app-bg" aria-hidden="true">
          <AppBackdrop />
        </div>
        <NextSSRPlugin routerConfig={extractRouterConfig(ourFileRouter)} />
        <Providers>
          <Header />
          <main className="flex-1">{children}</main>
          {/* Bottom bar renders on every page while signed in; it no-ops when signed out. */}
          <Suspense>
            <BottomBar />
          </Suspense>
          <Toaster />
          <ServiceWorkerRegistrar />
          <IosInstallNudge />
        </Providers>
      </body>
    </html>
  );
}
