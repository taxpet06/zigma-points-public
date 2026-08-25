"use client"

// AdminTermsPanel — create terms and set each one's start/end window.
//
// The current term is derived, not chosen: it's the most recent term that has already
// started. So "make this the current term" is just "give it a start date in the past" —
// the panel labels the current row rather than offering a switch that could disagree
// with the dates.
//
// ponytail: native <input type="datetime-local"> — no date-picker dependency. It shows
// and accepts the browser's local time; toLocal/fromLocal below convert to/from the Date
// the server stores in UTC.

import { useState } from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { Crown, Loader2, Plus, Trash2 } from "lucide-react"
import { toast } from "sonner"
import { useTRPC } from "@/trpc/client"
import { Button } from "@/components/ui/button"
import { FeedSkeleton } from "@/components/feed/feed-skeleton"
import { createTermSchema } from "@/lib/validation/term"
import { MAXXER_GOLD } from "@/components/cosmetics/crown-badge"

// Date -> "YYYY-MM-DDTHH:mm" in the viewer's own timezone (what the input expects).
function toLocal(d: Date | string) {
  const t = new Date(d)
  const pad = (n: number) => String(n).padStart(2, "0")
  return `${t.getFullYear()}-${pad(t.getMonth() + 1)}-${pad(t.getDate())}T${pad(t.getHours())}:${pad(t.getMinutes())}`
}

const inputClass =
  "h-10 w-full rounded-md border bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring"

interface Term {
  id: string
  name: string
  startsAt: Date
  endsAt: Date
  winnerId: string | null
}

interface PickableUser {
  id: string
  name: string | null
  username: string | null
}

// Label used by both pickers, so the same person reads the same way in each.
const userLabel = (u: PickableUser) =>
  u.name ?? (u.username ? `@${u.username}` : "Unnamed")

function TermRow({
  term,
  current,
  users,
}: {
  term: Term
  current: boolean
  users: PickableUser[]
}) {
  const trpc = useTRPC()
  const queryClient = useQueryClient()
  const [name, setName] = useState(term.name)
  const [startsAt, setStartsAt] = useState(toLocal(term.startsAt))
  const [endsAt, setEndsAt] = useState(toLocal(term.endsAt))
  const [error, setError] = useState<string | null>(null)
  const [confirmRemove, setConfirmRemove] = useState(false)

  const invalidate = () => {
    void queryClient.invalidateQueries(trpc.term.list.queryFilter())
    void queryClient.invalidateQueries(trpc.term.getCurrent.queryFilter())
    void queryClient.invalidateQueries(trpc.term.crownHolder.queryFilter())
  }

  // Declaring a winner also hands them the crown (server-side), so this invalidates
  // crownHolder too and every avatar on the page picks the new crown up.
  const setWinner = useMutation(
    trpc.term.setWinner.mutationOptions({
      onSuccess: (_d, vars) => {
        toast.success(vars.userId ? "Zigma Maxxer declared" : "Winner cleared")
        invalidate()
      },
      onError: (e) => toast.error(e.message || "Couldn't set that winner."),
    }),
  )

  const update = useMutation(
    trpc.term.update.mutationOptions({
      onSuccess: () => {
        toast.success("Term updated")
        setError(null)
        invalidate()
      },
      onError: (e) => setError(e.message || "Couldn't save that term."),
    }),
  )

  const remove = useMutation(
    trpc.term.remove.mutationOptions({
      onSuccess: () => {
        toast.success("Term deleted")
        invalidate()
      },
      onError: () => toast.error("Couldn't delete that term."),
    }),
  )

  const dirty =
    name !== term.name ||
    startsAt !== toLocal(term.startsAt) ||
    endsAt !== toLocal(term.endsAt)

  function save() {
    const parsed = createTermSchema.safeParse({ name, startsAt, endsAt })
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? "Check the dates")
      return
    }
    setError(null)
    update.mutate({ id: term.id, ...parsed.data })
  }

  return (
    <li className="rounded-lg border p-4">
      <div className="flex flex-wrap items-end gap-3">
        <div className="min-w-[10rem] flex-1">
          <label className="mb-1 block text-xs font-medium text-muted-foreground">
            Name
            {current && (
              <span className="ml-2 rounded-full bg-primary/10 px-2 py-0.5 text-[0.65rem] font-semibold text-primary">
                Current
              </span>
            )}
          </label>
          <input className={inputClass} value={name} onChange={(e) => setName(e.target.value)} />
        </div>
        <div className="min-w-[11rem] flex-1">
          <label className="mb-1 block text-xs font-medium text-muted-foreground">Starts</label>
          <input
            type="datetime-local"
            className={inputClass}
            value={startsAt}
            onChange={(e) => setStartsAt(e.target.value)}
          />
        </div>
        <div className="min-w-[11rem] flex-1">
          <label className="mb-1 block text-xs font-medium text-muted-foreground">Ends</label>
          <input
            type="datetime-local"
            className={inputClass}
            value={endsAt}
            onChange={(e) => setEndsAt(e.target.value)}
          />
        </div>
        <Button className="h-10" disabled={!dirty || update.isPending} onClick={save}>
          {update.isPending && <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />}
          Save
        </Button>
        {confirmRemove ? (
          <div className="flex items-center gap-2">
            <Button
              size="sm"
              variant="destructive"
              className="h-10"
              disabled={remove.isPending}
              onClick={() => {
                setConfirmRemove(false)
                remove.mutate({ id: term.id })
              }}
            >
              Delete
            </Button>
            <Button size="sm" variant="ghost" className="h-10" onClick={() => setConfirmRemove(false)}>
              Cancel
            </Button>
          </div>
        ) : (
          <button
            type="button"
            aria-label={`Delete ${term.name}`}
            className="h-10 rounded p-1.5 text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            onClick={() => setConfirmRemove(true)}
          >
            <Trash2 className="h-4 w-4" aria-hidden="true" />
          </button>
        )}
      </div>
      <div className="mt-3 flex flex-wrap items-end gap-3 border-t pt-3">
        <div className="min-w-[14rem] flex-1">
          <label className="mb-1 block text-xs font-medium text-muted-foreground">
            Zigma Maxxer
          </label>
          <select
            className={inputClass}
            aria-label={`Zigma Maxxer for ${term.name}`}
            disabled={setWinner.isPending}
            value={term.winnerId ?? ""}
            onChange={(e) =>
              setWinner.mutate({ termId: term.id, userId: e.target.value || null })
            }
          >
            <option value="">— No winner —</option>
            {users.map((u) => (
              <option key={u.id} value={u.id}>
                {userLabel(u)}
              </option>
            ))}
          </select>
        </div>
        <p className="pb-2 text-xs text-muted-foreground">
          One per term. Declaring a winner also gives them the crown.
        </p>
      </div>
      {error && (
        <p role="alert" className="mt-2 text-sm text-destructive">
          {error}
        </p>
      )}
    </li>
  )
}

// Who wears the crown right now. Separate from the winner pickers because it is a
// single app-wide slot, not a per-term one — declaring a winner sets it, and this is
// the override.
function CrownPanel({ users }: { users: PickableUser[] }) {
  const trpc = useTRPC()
  const queryClient = useQueryClient()
  const { data: holder } = useQuery(trpc.term.crownHolder.queryOptions())

  const setCrown = useMutation(
    trpc.term.setCrown.mutationOptions({
      onSuccess: (_d, vars) => {
        toast.success(vars.userId ? "Crown moved" : "Crown removed")
        void queryClient.invalidateQueries(trpc.term.crownHolder.queryFilter())
      },
      onError: (e) => toast.error(e.message || "Couldn't move the crown."),
    }),
  )

  return (
    <div className="rounded-lg border p-4">
      <div className="flex flex-wrap items-end gap-3">
        <div className="min-w-[14rem] flex-1">
          <label
            htmlFor="crown-holder"
            className="mb-1 flex items-center gap-1.5 text-xs font-medium text-muted-foreground"
          >
            <Crown className="h-3.5 w-3.5" style={{ color: MAXXER_GOLD }} aria-hidden="true" />
            Crown holder
          </label>
          <select
            id="crown-holder"
            className={inputClass}
            disabled={setCrown.isPending}
            value={holder?.id ?? ""}
            onChange={(e) => setCrown.mutate({ userId: e.target.value || null })}
          >
            <option value="">— Nobody —</option>
            {users.map((u) => (
              <option key={u.id} value={u.id}>
                {userLabel(u)}
              </option>
            ))}
          </select>
        </div>
        <p className="pb-2 text-xs text-muted-foreground">
          Exactly one person wears the crown app-wide. It defaults to the last winner you
          declared — change it here only to override that.
        </p>
      </div>
    </div>
  )
}

function CreateTermForm() {
  const trpc = useTRPC()
  const queryClient = useQueryClient()
  const [name, setName] = useState("")
  const [startsAt, setStartsAt] = useState("")
  const [endsAt, setEndsAt] = useState("")
  const [error, setError] = useState<string | null>(null)

  const create = useMutation(
    trpc.term.create.mutationOptions({
      onSuccess: () => {
        toast.success("Term created")
        setName("")
        setStartsAt("")
        setEndsAt("")
        setError(null)
        void queryClient.invalidateQueries(trpc.term.list.queryFilter())
        void queryClient.invalidateQueries(trpc.term.getCurrent.queryFilter())
      },
      onError: (e) => setError(e.message || "Couldn't create that term."),
    }),
  )

  function submit(e: React.FormEvent) {
    e.preventDefault()
    const parsed = createTermSchema.safeParse({ name, startsAt, endsAt })
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? "Fill in a name and both dates")
      return
    }
    setError(null)
    create.mutate(parsed.data)
  }

  return (
    <form onSubmit={submit} className="rounded-lg border p-4">
      <div className="flex flex-wrap items-end gap-3">
        <div className="min-w-[10rem] flex-1">
          <label htmlFor="term-name" className="mb-1 block text-xs font-medium text-muted-foreground">
            Name
          </label>
          <input
            id="term-name"
            className={inputClass}
            placeholder="Fall 2026"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </div>
        <div className="min-w-[11rem] flex-1">
          <label htmlFor="term-start" className="mb-1 block text-xs font-medium text-muted-foreground">
            Starts
          </label>
          <input
            id="term-start"
            type="datetime-local"
            className={inputClass}
            value={startsAt}
            onChange={(e) => setStartsAt(e.target.value)}
          />
        </div>
        <div className="min-w-[11rem] flex-1">
          <label htmlFor="term-end" className="mb-1 block text-xs font-medium text-muted-foreground">
            Ends
          </label>
          <input
            id="term-end"
            type="datetime-local"
            className={inputClass}
            value={endsAt}
            onChange={(e) => setEndsAt(e.target.value)}
          />
        </div>
        <Button type="submit" className="h-10" disabled={create.isPending}>
          {create.isPending ? (
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
          ) : (
            <Plus className="h-4 w-4" aria-hidden="true" />
          )}
          New term
        </Button>
      </div>
      {error && (
        <p role="alert" className="mt-2 text-sm text-destructive">
          {error}
        </p>
      )}
    </form>
  )
}

export function AdminTermsPanel() {
  const trpc = useTRPC()
  const { data: terms, isLoading } = useQuery(trpc.term.list.queryOptions())
  const { data: current } = useQuery(trpc.term.getCurrent.queryOptions())
  const { data: users } = useQuery(trpc.user.getAll.queryOptions())
  const pickable: PickableUser[] = users ?? []

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">
        The current term is whichever one started most recently — everyone&apos;s header counts
        down to its end, then reads &ldquo;Term Ended&rdquo;.
      </p>

      <CreateTermForm />

      <CrownPanel users={pickable} />

      {isLoading ? (
        <FeedSkeleton count={2} />
      ) : !terms || terms.length === 0 ? (
        <p className="py-8 text-center text-sm text-muted-foreground">No terms yet.</p>
      ) : (
        <ul className="space-y-3">
          {terms.map((t) => (
            <TermRow
              key={t.id}
              term={t}
              current={t.id === current?.id}
              users={pickable}
            />
          ))}
        </ul>
      )}
    </div>
  )
}
