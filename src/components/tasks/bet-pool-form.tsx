"use client"

// BetPoolForm — the "create a Betting Pool" form body, without a Dialog of its own.
// Shared by two surfaces so the fields can't drift:
//   • the admin Create Activity modal (Standard Task ／ Betting Pool)
//   • the bottom-bar plus modal, where it sits alongside Award ／ Deduct
//
// Betting pools are user-creatable (task.createTask allows kind BET for anyone).
// Declaring the outcome and cancelling stay admin-only — bet.settleBet / bet.cancelBet.

import { useState } from "react"
import { useRouter } from "next/navigation"
import { useForm, type Resolver } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import { z } from "zod"
import { useMutation, useQueryClient } from "@tanstack/react-query"
import { Loader2, Plus, X } from "lucide-react"
import { toast } from "sonner"
import { useTRPC } from "@/trpc/client"
import { createTaskSchema } from "@/lib/validation/task"
import { DialogFooter } from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
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
import { Label } from "@/components/ui/label"
import { ImageUploadField } from "@/components/ui/image-upload-field"

type CreateTaskValues = z.infer<typeof createTaskSchema>

export function BetPoolForm({ onDone }: { onDone: () => void }) {
  const trpc = useTRPC()
  const router = useRouter()
  const queryClient = useQueryClient()
  const [uploading, setUploading] = useState(false)

  const form = useForm<CreateTaskValues>({
    // z.coerce.number() gives the resolver an unknown input type; cast to align generics
    resolver: zodResolver(createTaskSchema) as Resolver<CreateTaskValues>,
    defaultValues: {
      title: "",
      description: "",
      kind: "BET",
      minBet: 1,
      choices: ["", ""],
      images: [],
    },
  })

  const createTask = useMutation(
    trpc.task.createTask.mutationOptions({
      onSuccess: (task) => {
        form.reset()
        // The pool lands in the Posts feed now, not the Activities list.
        void queryClient.invalidateQueries(trpc.post.getFeed.queryFilter())
        toast.success("Betting pool created")
        onDone()
        // The plus button lives on every page, so the new pool is usually off-screen —
        // land on it, which is also where the admin controls are.
        router.push(`/tasks/${task.id}`)
      },
      onError: () => {
        form.setError("root", { message: "Failed to create the pool. Please try again." })
        toast.error("Failed to create the pool. Please try again.")
      },
    })
  )

  const choices = form.watch("choices") ?? []

  function setChoice(i: number, value: string) {
    const next = [...choices]
    next[i] = value
    form.setValue("choices", next, { shouldValidate: true, shouldDirty: true })
  }
  function addChoice() {
    form.setValue("choices", [...choices, ""], { shouldDirty: true })
  }
  function removeChoice(i: number) {
    form.setValue(
      "choices",
      choices.filter((_, idx) => idx !== i),
      { shouldValidate: true, shouldDirty: true }
    )
  }

  // superRefine attaches BET errors at these exact paths.
  const choicesError = form.formState.errors.choices as { message?: string } | undefined
  const minBetError = form.formState.errors.minBet as { message?: string } | undefined
  const betsCloseAtError = form.formState.errors.betsCloseAt as { message?: string } | undefined

  return (
    <Form {...form}>
      <form
        onSubmit={form.handleSubmit((data) => createTask.mutate({ ...data, kind: "BET" }))}
        className="space-y-4"
      >
        {/* What happens next — sets expectations before they fill the form. */}
        <p className="text-xs text-muted-foreground text-pretty">
          Members stake ZP on a choice. When an admin declares the outcome, the whole pot is
          split among the backers of the winning choice.
        </p>

        <FormField
          control={form.control}
          name="title"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Title</FormLabel>
              <FormControl>
                <Input placeholder="Who wins Masters A?" {...field} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        <FormField
          control={form.control}
          name="description"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Description</FormLabel>
              <FormControl>
                <Textarea
                  rows={4}
                  placeholder="Pick the team you think takes first place, then stake your ZP."
                  {...field}
                />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        <FormField
          control={form.control}
          name="images"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Images</FormLabel>
              <FormControl>
                <ImageUploadField
                  value={field.value ?? []}
                  onChange={field.onChange}
                  onUploadingChange={setUploading}
                />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        {/* Choices editor */}
        <div className="space-y-2">
          <Label>Choices</Label>
          <div className="space-y-2">
            {choices.map((c, i) => (
              <div key={i} className="flex items-center gap-2">
                <Input
                  placeholder={`Choice ${i + 1}`}
                  value={c}
                  onChange={(e) => setChoice(i, e.target.value)}
                  maxLength={60}
                />
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  aria-label={`Remove choice ${i + 1}`}
                  disabled={choices.length <= 2}
                  onClick={() => removeChoice(i)}
                >
                  <X className="h-4 w-4" />
                </Button>
              </div>
            ))}
          </div>
          <Button type="button" variant="outline" size="sm" className="w-full" onClick={addChoice}>
            <Plus className="h-4 w-4" /> Add choice
          </Button>
          {choicesError?.message && (
            <p className="text-sm text-destructive">{choicesError.message}</p>
          )}
        </div>

        <FormField
          control={form.control}
          name="minBet"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Minimum bet (ZP)</FormLabel>
              <FormControl>
                <Input type="number" min={1} placeholder="1" {...field} value={field.value ?? ""} />
              </FormControl>
              {minBetError?.message && (
                <p className="text-sm text-destructive">{minBetError.message}</p>
              )}
            </FormItem>
          )}
        />

        <FormField
          control={form.control}
          name="betsCloseAt"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Bets close at (optional)</FormLabel>
              <FormControl>
                <Input
                  type="datetime-local"
                  // RHF holds the raw input string; zod coerces to Date on submit.
                  value={(field.value as unknown as string) ?? ""}
                  onChange={field.onChange}
                  onBlur={field.onBlur}
                  name={field.name}
                  ref={field.ref}
                />
              </FormControl>
              <p className="text-xs text-muted-foreground">
                Bets lock in at this time. Leave empty to keep betting open until an admin
                declares the outcome.
              </p>
              {betsCloseAtError?.message && (
                <p className="text-sm text-destructive">{betsCloseAtError.message}</p>
              )}
            </FormItem>
          )}
        />

        {form.formState.errors.root && (
          <p role="alert" className="text-sm text-destructive">
            {form.formState.errors.root.message}
          </p>
        )}

        {uploading && (
          <p role="alert" className="text-sm font-medium text-destructive">
            Some photos haven&apos;t fully loaded yet — wait for them to finish before submitting.
          </p>
        )}

        <DialogFooter>
          <Button type="button" variant="outline" onClick={onDone}>
            Discard
          </Button>
          <Button type="submit" variant="default" disabled={createTask.isPending || uploading}>
            {createTask.isPending ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Submitting…
              </>
            ) : (
              "Create Pool"
            )}
          </Button>
        </DialogFooter>
      </form>
    </Form>
  )
}
