"use client"
// ClaimUsernameForm — inline username claim form shown when an authenticated user
// has not yet claimed a username (D-03).
//
// Renders on the /profile/edit page (or any page that surfaces it) when
// the user's username is null.
//
// Security:
//   T-02-13 — claimUsername uses usernameSchema regex; P2002 prevents handle takeover.
//   T-02-14 — href is built from the server's own claimUsername return value, not client input.
//
// UI-SPEC:
//   States: Idle / Submitting ("Claiming…") / Error-taken / Error-invalid / Success
//   Copy: "Choose your username", claim body, "Claim username", "Claiming…",
//         "That username is already taken.", "Only lowercase letters, numbers, and underscores allowed."

import { useForm } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import { z } from "zod"
import { useMutation, useQueryClient } from "@tanstack/react-query"
import { useRouter } from "next/navigation"
import { useTRPC } from "@/trpc/client"
import { usernameSchema } from "@/lib/validation/username"
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import { Card, CardHeader, CardContent } from "@/components/ui/card"

const claimUsernameFormSchema = z.object({
  username: usernameSchema,
})

type ClaimUsernameValues = z.infer<typeof claimUsernameFormSchema>

export function ClaimUsernameForm() {
  const trpc = useTRPC()
  const router = useRouter()
  const queryClient = useQueryClient()

  const form = useForm<ClaimUsernameValues>({
    resolver: zodResolver(claimUsernameFormSchema),
    defaultValues: { username: "" },
  })

  const claimUsername = useMutation(
    trpc.user.claimUsername.mutationOptions()
  )

  async function onSubmit(values: ClaimUsernameValues) {
    try {
      const result = await claimUsername.mutateAsync({ username: values.username })
      // On success, invalidate getMe so the nav header avatar link updates to /u/[username]
      await queryClient.invalidateQueries(trpc.user.getMe.queryFilter())
      // Navigate to the new profile URL (D-03)
      if (result.username) {
        router.push(`/u/${result.username}`)
      }
    } catch (err: unknown) {
      // CONFLICT error from claimUsername — username already taken (T-02-13)
      const anyErr = err as { data?: { code?: string }; message?: string }
      if (anyErr?.data?.code === "CONFLICT") {
        form.setError("username", {
          message: "That username is already taken.",
        })
      }
      // Zod / format errors are handled by react-hook-form via zodResolver
    }
  }

  const isSubmitting = claimUsername.isPending

  return (
    <Card>
      <CardHeader>
        <h2 className="text-xl font-semibold">Choose your username</h2>
        <p className="text-sm text-muted-foreground">
          Pick a handle that others will use to find your profile. Lowercase
          letters, numbers, and underscores only — between 3 and 20 characters.
        </p>
      </CardHeader>
      <CardContent>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
            <FormField
              control={form.control}
              name="username"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Username</FormLabel>
                  <FormControl>
                    <Input
                      placeholder="e.g. john_doe"
                      disabled={isSubmitting}
                      {...field}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <Button type="submit" disabled={isSubmitting} className="w-full">
              {isSubmitting ? "Claiming…" : "Claim username"}
            </Button>
          </form>
        </Form>
      </CardContent>
    </Card>
  )
}
