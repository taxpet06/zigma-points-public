"use client"

// CreateTaskModal — admin form for creating Task Posts.
// Two kinds (D-03 extension):
//   STANDARD — complete-to-earn task (zpReward), the original behaviour. Admin-only.
//   BET      — multiple-choice pari-mutuel pool. The form body lives in BetPoolForm,
//              shared with the bottom-bar plus modal (users can open pools too).
//
// Security: task.createTask is FORBIDDEN-guarded server-side for STANDARD (Plan 06-01).

import { useState } from "react"
import { useForm, type Resolver } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import { z } from "zod"
import { useMutation, useQueryClient } from "@tanstack/react-query"
import { Loader2 } from "lucide-react"
import { toast } from "sonner"
import { useTRPC } from "@/trpc/client"
import { createTaskSchema } from "@/lib/validation/task"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  DialogFooter,
} from "@/components/ui/dialog"
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
import { ImageUploadField } from "@/components/ui/image-upload-field"
import { BetPoolForm } from "@/components/tasks/bet-pool-form"

type CreateTaskValues = z.infer<typeof createTaskSchema>

function StandardTaskForm({ onDone }: { onDone: () => void }) {
  const trpc = useTRPC()
  const queryClient = useQueryClient()
  const [uploading, setUploading] = useState(false)

  const form = useForm<CreateTaskValues>({
    // z.coerce.number() gives the resolver an unknown input type; cast to align generics
    resolver: zodResolver(createTaskSchema) as Resolver<CreateTaskValues>,
    defaultValues: {
      title: "",
      description: "",
      kind: "STANDARD",
      zpReward: 1,
      images: [],
    },
  })

  const createTask = useMutation(
    trpc.task.createTask.mutationOptions({
      onSuccess: () => {
        form.reset()
        void queryClient.invalidateQueries(trpc.task.getTasks.queryFilter())
        toast.success("Activity created")
        onDone()
      },
      onError: () => {
        form.setError("root", { message: "Failed to create activity. Please try again." })
        toast.error("Failed to create activity. Please try again.")
      },
    })
  )

  return (
    <Form {...form}>
      <form
        onSubmit={form.handleSubmit((data) => createTask.mutate({ ...data, kind: "STANDARD" }))}
        className="space-y-4"
      >
        <FormField
          control={form.control}
          name="title"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Title</FormLabel>
              <FormControl>
                <Input placeholder="Activity title" {...field} />
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
                  placeholder="Describe what users need to do to complete this activity."
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

        <FormField
          control={form.control}
          name="zpReward"
          render={({ field }) => (
            <FormItem>
              <FormLabel>ZP Reward</FormLabel>
              <FormControl>
                <Input type="number" min={1} placeholder="1" {...field} />
              </FormControl>
              <FormMessage />
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
            Discard Changes
          </Button>
          <Button type="submit" variant="default" disabled={createTask.isPending || uploading}>
            {createTask.isPending ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Submitting…
              </>
            ) : (
              "Create Activity"
            )}
          </Button>
        </DialogFooter>
      </form>
    </Form>
  )
}

export function CreateTaskModal() {
  const [open, setOpen] = useState(false)
  // Switching kind swaps the whole form (each owns its own RHF state), so a draft
  // doesn't survive the toggle — the two kinds share only title/description anyway.
  const [kind, setKind] = useState<"STANDARD" | "BET">("STANDARD")

  function handleOpenChange(v: boolean) {
    if (!v) setKind("STANDARD")
    setOpen(v)
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger asChild>
        <Button variant="default">Create Activity</Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Create Activity</DialogTitle>
        </DialogHeader>

        {/* Kind toggle */}
        <div role="group" aria-label="Activity kind" className="flex gap-2">
          <Button
            type="button"
            variant={kind === "STANDARD" ? "default" : "outline"}
            className="w-full"
            aria-pressed={kind === "STANDARD"}
            onClick={() => setKind("STANDARD")}
          >
            Standard Task
          </Button>
          <Button
            type="button"
            variant={kind === "BET" ? "default" : "outline"}
            className="w-full"
            aria-pressed={kind === "BET"}
            onClick={() => setKind("BET")}
          >
            Betting Pool
          </Button>
        </div>

        {kind === "STANDARD" ? (
          <StandardTaskForm onDone={() => setOpen(false)} />
        ) : (
          <BetPoolForm onDone={() => setOpen(false)} />
        )}
      </DialogContent>
    </Dialog>
  )
}
