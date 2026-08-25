"use client"

// EditProfileForm — client component for editing display name and bio.
//
// Security:
//   T-02-09 — form submits only { name, bio }; updateProfile ignores role/zigmaPoints.
//   Form never accepts or sends a userId — reads/writes only the session user via getMe/updateProfile.
//
// UX per UI-SPEC:
//   - Fields pre-populated from getMe query.
//   - Bio 160-char limit enforced by Zod + live counter with text-destructive at 160 (D-06).
//   - AvatarUpload is rendered by the page above this form, not by this component.
//   - Save button: "Save changes" idle, "Saving…" submitting.
//   - Success: no redirect; stay on page (UI-SPEC Edit Profile Form success state).
//   - Error: FormMessage "Failed to save. Please try again."

import { useEffect } from "react"
import { useForm } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import { z } from "zod"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { useTRPC } from "@/trpc/client"
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"

// Exported so the TDD schema tests can import it once the GREEN phase is done.
export const editProfileSchema = z.object({
  name: z.string().trim().min(1, "Name is required").max(50, "Name cannot exceed 50 characters"),
  bio: z.string().max(160, "Bio cannot exceed 160 characters"),
})

type EditProfileValues = z.infer<typeof editProfileSchema>

export function EditProfileForm() {
  const trpc = useTRPC()
  const queryClient = useQueryClient()

  // Load current values from the server (pre-populate form).
  const { data: me } = useQuery(trpc.user.getMe.queryOptions())

  const form = useForm<EditProfileValues>({
    resolver: zodResolver(editProfileSchema),
    defaultValues: { name: "", bio: "" },
  })

  // Pre-populate once getMe loads — only if the form hasn't been modified by the user.
  // This prevents overwriting user input when getMe resolves after typing has started.
  useEffect(() => {
    if (me && !form.formState.isDirty) {
      form.reset({
        name: me.name ?? "",
        bio: me.bio ?? "",
      })
    }
  }, [me, form])

  const updateProfile = useMutation(
    trpc.user.updateProfile.mutationOptions({
      onSuccess: () => {
        // Invalidate getMe so nav and header reflect the new name.
        queryClient.invalidateQueries(trpc.user.getMe.queryFilter())
      },
    })
  )

  const bioValue = form.watch("bio") ?? ""
  const bioAtLimit = bioValue.length >= 160

  function onSubmit(values: EditProfileValues) {
    updateProfile.mutate({ name: values.name, bio: values.bio })
  }

  return (
    <div className="space-y-6">
      {/* Name + bio form */}
      <Form {...form}>
        <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
          {/* Display name */}
          <FormField
            control={form.control}
            name="name"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Display name</FormLabel>
                <FormControl>
                  <Input placeholder="Your name" {...field} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />

          {/* Bio with live 160-char counter */}
          <FormField
            control={form.control}
            name="bio"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Bio</FormLabel>
                <FormControl>
                  <Textarea
                    placeholder="Tell the community about yourself"
                    rows={4}
                    className={cn(bioAtLimit && "border-destructive")}
                    {...field}
                  />
                </FormControl>
                <div className="flex justify-end">
                  <span
                    aria-live="polite"
                    className={cn(
                      "text-sm text-muted-foreground",
                      bioAtLimit && "text-destructive"
                    )}
                  >
                    {bioValue.length} / 160
                  </span>
                </div>
                <FormMessage />
              </FormItem>
            )}
          />

          {/* Submission error */}
          {updateProfile.isError && (
            <p role="alert" className="text-sm font-medium text-destructive">
              Failed to save. Please try again.
            </p>
          )}

          {/* Submit button */}
          <Button
            type="submit"
            className="w-full"
            disabled={updateProfile.isPending}
          >
            {updateProfile.isPending ? "Saving…" : "Save changes"}
          </Button>
        </form>
      </Form>
    </div>
  )
}
