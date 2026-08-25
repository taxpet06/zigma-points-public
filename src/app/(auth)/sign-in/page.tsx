"use client"
// Sign-in page -- AUTH-02.
// Form with Email + Password fields. Submits via next-auth/react signIn (client-safe).
// next-auth/react signIn is the correct import for Client Components -- it calls
// the NextAuth API route (/api/auth/signin) rather than pulling in the server auth config.
// Displays an error on invalid credentials.

import { useState, useTransition } from "react"
import Link from "next/link"
import { signIn } from "next-auth/react"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Label } from "@/components/ui/label"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"

export default function SignInPage() {
  const [error, setError] = useState<string | null>(null)
  const [isPending, startTransition] = useTransition()

  async function handleSubmit(formData: FormData) {
    setError(null)
    const email = formData.get("email") as string
    const password = formData.get("password") as string

    startTransition(async () => {
      const result = await signIn("credentials", {
        email,
        password,
        redirect: false,
      })
      // result is undefined on successful redirect, or has error on failure
      if (result?.error) {
        setError("Invalid email or password. Please try again.")
      } else if (!result?.error) {
        // Sign-in succeeded. Use a HARD navigation (not router.replace): a soft
        // App Router navigation replays the Router Cache entry for "/" that was
        // populated while logged out (middleware bounced it to /sign-in), leaving
        // the user stuck here. window.location.replace forces a fresh request
        // through middleware WITH the new session cookie, and drops /sign-in from
        // history so Back doesn't return to it.
        window.location.replace("/")
      }
    })
  }

  return (
    <div className="flex min-h-[calc(100dvh-3.5rem)] items-center justify-center px-4">
      <Card className="w-full max-w-sm animate-card-rise">
        <CardHeader>
          <CardTitle className="text-2xl">Sign in</CardTitle>
          <CardDescription>
            Enter your credentials to access your account
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form action={handleSubmit} className="space-y-4">
            <div className="space-y-1">
              <Label htmlFor="email">Email</Label>
              <Input
                id="email"
                name="email"
                type="email"
                autoComplete="email"
                required
                placeholder="you@example.com"
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="password">Password</Label>
              <Input
                id="password"
                name="password"
                type="password"
                autoComplete="current-password"
                required
                placeholder="Your password"
              />
            </div>

            {error && (
              <p role="alert" className="text-sm text-destructive">
                {error}
              </p>
            )}

            <Button type="submit" className="w-full" disabled={isPending}>
              {isPending ? "Signing in..." : "Sign in"}
            </Button>
          </form>

          <p className="mt-4 text-center text-sm">
            <Link
              href="/forgot-password"
              className="text-muted-foreground"
            >
              Forgot your password?
            </Link>
          </p>

          <p className="mt-4 text-center text-sm text-muted-foreground">
            Don&apos;t have an account?{" "}
            <Link
              href="/sign-up"
              className="font-medium text-foreground"
            >
              Sign up
            </Link>
          </p>
        </CardContent>
      </Card>
    </div>
  )
}
