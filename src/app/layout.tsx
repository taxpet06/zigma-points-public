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
import { downtimeState } from "@/lib/downtime";
import { auth } from "@/auth";

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

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  // Between terms the site is one static page and nothing else, so everything interactive
  // comes off: no tRPC providers, no session, no toaster, no service worker, no install
  // nudge. The backdrop stays — pure server-rendered CSS, and it is what makes the closed
  // door still look like Zigma Points.
  //
  // Asked directly rather than read off a request header set by middleware: a header
  // arrives with the request, nothing strips an inbound copy, and `curl -H "x-downtime: 1"`
  // would then strip the providers out from under a live page's client components. The
  // cached lookup is the same one middleware just did.
  //
  // ADMINS ARE NEVER BARE. This used to need no role test, because while down /downtime
  // was the only page middleware let through. That is no longer true: admins keep the
  // portal during a break (middleware.ts) so they can declare a Maxxer, mark Poopers and
  // reopen the app. Stripping <Providers> from under them served /admin with no tRPC
  // client at all, so every query on the page threw "useTRPC() can only be used inside
  // of a <TRPCProvider>" — the portal was reachable but dead on arrival.
  //
  // The session lookup only runs while the app is closed, so an open app pays nothing.
  // Role comes from the JWT, which is a snapshot — fine here, because this decides only
  // whether to MOUNT the client stack. Every privileged action behind it re-reads the
  // role from the database (adminProcedure in trpc/init.ts).
  //
  // This opts the app out of static rendering. It rendered nothing statically to begin
  // with: every route sits behind the auth middleware and none set force-static.
  const { down } = await downtimeState();
  const bare = down && (await auth())?.user?.role !== "ADMIN";

  // next-themes runs forcedTheme="dark" for the whole app, but it lives inside
  // <Providers> — which the bare layout does without. Without this nothing would put
  // .dark on the root and the closed door alone would render in light mode.
  const themeClass = bare ? " dark" : "";

  return (
    <html
      lang="en"
      className={`${inter.variable} ${jetbrainsMono.variable} h-full antialiased${themeClass}`}
      suppressHydrationWarning
    >
      <body className="min-h-full flex flex-col">
        <div className="app-bg" aria-hidden="true">
          <AppBackdrop />
        </div>
        {bare ? (
          <main className="flex-1">{children}</main>
        ) : (
          <>
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
          </>
        )}
      </body>
    </html>
  );
}
