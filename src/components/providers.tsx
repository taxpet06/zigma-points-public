"use client"

import { ThemeProvider } from "next-themes"
import { SessionProvider } from "next-auth/react"
import { TRPCReactProvider } from "@/trpc/client"

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <ThemeProvider attribute="class" forcedTheme="dark" disableTransitionOnChange>
      <SessionProvider>
        <TRPCReactProvider>{children}</TRPCReactProvider>
      </SessionProvider>
    </ThemeProvider>
  )
}
