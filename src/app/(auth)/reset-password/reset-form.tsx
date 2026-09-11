"use client"
// Client form for setting a new password from a reset link (AUTH-05).

import { useState, useTransition } from "react"
import Link from "next/link"
import { resetPassword } from "@/lib/actions/password-reset"
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

export default function ResetPasswordForm({ token }: { token: string }) {
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState(false)
  const [isPending, startTransition] = useTransition()

  function handleSubmit(formData: FormData) {
    setError(null)
    const password = formData.get("password") as string
    const confirm = formData.get("confirm") as string
    if (password !== confirm) {
      setError("Passwords do not match.")
      return
    }
    startTransition(async () => {
      const result = await resetPassword(token, password)
      if (result.success) {
        setDone(true)
      } else {
        setError(result.error)
      }
    })
  }

  return (
    <div className="flex min-h-[calc(100dvh-3.5rem)] items-center justify-center px-4">
      <Card className="w-full max-w-sm animate-card-rise">
        <CardHeader>
          <CardTitle className="text-2xl">Reset password</CardTitle>
          <CardDescription>
            {done ? "Password updated" : "Choose a new password"}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {done ? (
            <p className="text-sm text-muted-foreground">
              Your password has been updated.{" "}
              <Link
                href="/sign-in"
                className="font-medium text-foreground"
              >
                Sign in
              </Link>
              .
            </p>
          ) : !token ? (
            <p className="text-sm text-destructive">
              This reset link is invalid or has expired.{" "}
              <Link
                href="/forgot-password"
                className="font-medium text-foreground"
              >
                Request a new one
              </Link>
              .
            </p>
          ) : (
            <form action={handleSubmit} className="space-y-4">
              <div className="space-y-1">
                <Label htmlFor="password">New password</Label>
                <Input
                  id="password"
                  name="password"
                  type="password"
                  autoComplete="new-password"
                  required
                  minLength={8}
                  placeholder="At least 8 characters"
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor="confirm">Confirm password</Label>
                <Input
                  id="confirm"
                  name="confirm"
                  type="password"
                  autoComplete="new-password"
                  required
                  minLength={8}
                  placeholder="Re-enter your password"
                />
              </div>

              {error && (
                <p role="alert" className="text-sm text-destructive">
                  {error}
                </p>
              )}

              <Button type="submit" className="w-full" disabled={isPending}>
                {isPending ? "Updating..." : "Update password"}
              </Button>
            </form>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
