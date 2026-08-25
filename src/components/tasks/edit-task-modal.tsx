"use client"

// EditTaskModal — admin-only edit for an existing task (pencil trigger).
// STANDARD tasks: editable any time (title, description, zpReward).
// BET tasks: editable only while the pool is open — the server rejects edits on
// locked/settled pools, and callers hide the trigger then. kind and choices are
// immutable: placed bets reference choice strings.
//
// Security: task.updateTask is FORBIDDEN-guarded server-side, mirroring createTask.

import { useState } from "react"
import { useForm, type Resolver } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import { z } from "zod"
import { useMutation, useQueryClient } from "@tanstack/react-query"
import { useRouter } from "next/navigation"
import { Loader2, Pencil } from "lucide-react"
import { toast } from "sonner"
import { useTRPC } from "@/trpc/client"
import { updateTaskSchema } from "@/lib/validation/task"
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

type UpdateTaskValues = z.infer<typeof updateTaskSchema>

// Date → "yyyy-MM-ddTHH:mm" in the viewer's timezone (what datetime-local expects).
function toLocalInput(d: Date | null): string {
  if (!d) return ""
  const dt = new Date(d)
  dt.setMinutes(dt.getMinutes() - dt.getTimezoneOffset())
  return dt.toISOString().slice(0, 16)
}

export interface EditTaskModalProps {
  task: {
    id: string
    kind: "STANDARD" | "BET"
    title: string
    description: string
    zpReward: number | null
    minBet: number | null
    betsCloseAt: Date | null
  }
}

export function EditTaskModal({ task }: EditTaskModalProps) {
  const trpc = useTRPC()
  const queryClient = useQueryClient()
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const isBet = task.kind === "BET"

  const defaults: UpdateTaskValues = {
    taskId: task.id,
    title: task.title,
    description: task.description,
    zpReward: task.zpReward ?? 1,
    minBet: task.minBet ?? 1,
    // RHF holds the raw datetime-local string; zod coerces to Date on submit.
    betsCloseAt: toLocalInput(task.betsCloseAt) as unknown as UpdateTaskValues["betsCloseAt"],
  }

  const form = useForm<UpdateTaskValues>({
    resolver: zodResolver(updateTaskSchema) as Resolver<UpdateTaskValues>,
    defaultValues: defaults,
  })

  const updateTask = useMutation(
    trpc.task.updateTask.mutationOptions({
      onSuccess: () => {
        setOpen(false)
        void queryClient.invalidateQueries(trpc.task.getTasks.queryFilter())
        void queryClient.invalidateQueries(
          trpc.bet.getBetState.queryFilter({ taskId: task.id })
        )
        router.refresh() // server-rendered task pages re-read the row
        toast.success("Activity updated")
      },
      onError: (e) => toast.error(e.message || "Failed to update activity."),
    })
  )

  function handleOpenChange(v: boolean) {
    if (v) form.reset(defaults) // re-seed from current props on every open
    setOpen(v)
  }

  const betsCloseAtError = form.formState.errors.betsCloseAt as { message?: string } | undefined

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger asChild>
        <Button variant="ghost" size="icon" className="h-7 w-7" aria-label="Edit activity">
          <Pencil className="h-3.5 w-3.5" />
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Edit {isBet ? "Betting Pool" : "activity"}</DialogTitle>
        </DialogHeader>
        <Form {...form}>
          <form onSubmit={form.handleSubmit((data) => updateTask.mutate(data))} className="space-y-4">
            <FormField
              control={form.control}
              name="title"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Title</FormLabel>
                  <FormControl>
                    <Input {...field} />
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
                    <Textarea rows={4} {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            {isBet ? (
              <>
                <FormField
                  control={form.control}
                  name="minBet"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Minimum bet (ZP)</FormLabel>
                      <FormControl>
                        <Input type="number" min={1} {...field} value={field.value ?? ""} />
                      </FormControl>
                      <FormMessage />
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
                          value={(field.value as unknown as string) ?? ""}
                          onChange={field.onChange}
                          onBlur={field.onBlur}
                          name={field.name}
                          ref={field.ref}
                        />
                      </FormControl>
                      <p className="text-xs text-muted-foreground">
                        Bets lock in at this time — once locked, the pool can&apos;t be edited
                        or reopened. Clear the field to keep betting open until you settle.
                      </p>
                      {betsCloseAtError?.message && (
                        <p className="text-sm text-destructive">{betsCloseAtError.message}</p>
                      )}
                    </FormItem>
                  )}
                />
              </>
            ) : (
              <FormField
                control={form.control}
                name="zpReward"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>ZP Reward</FormLabel>
                    <FormControl>
                      <Input type="number" min={1} {...field} value={field.value ?? ""} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            )}

            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setOpen(false)}>
                Cancel
              </Button>
              <Button type="submit" disabled={updateTask.isPending}>
                {updateTask.isPending ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Saving…
                  </>
                ) : (
                  "Save changes"
                )}
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  )
}
