"use client"

import { useState } from "react"
import { useQuery } from "@tanstack/react-query"
import { useSession } from "next-auth/react"
import { ArrowLeft, Check } from "lucide-react"
import { useTRPC } from "@/trpc/client"
import { UserAvatar } from "@/components/cosmetics/user-avatar"
import { CardBackground } from "@/components/cosmetics/card-background"
import { TitleChip } from "@/components/cosmetics/title-chip"
import { MaxxerTrophy } from "@/components/cosmetics/maxxer-trophy"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { cn } from "@/lib/utils"

export function UserPickerView({
  value,
  onConfirm,
  onBack,
}: {
  value: string[]
  onConfirm: (userIds: string[]) => void
  onBack: () => void
}) {
  const trpc = useTRPC()
  const { data: session } = useSession()
  const currentUserId = session?.user?.id
  const [query, setQuery] = useState("")
  const [checked, setChecked] = useState<Set<string>>(() => new Set(value))

  // getAll (not searchUsers) — this view is a browsable grid of everyone with a
  // client-side filter, not a server-searched subset; react-query dedups the
  // request with the People tab / autocomplete so there is no extra network call.
  // getAll does not exclude self, so it is filtered out here.
  const { data: users, isLoading } = useQuery(trpc.user.getAll.queryOptions())

  const members = (users ?? []).filter((u) => u.id !== currentUserId)
  const filtered =
    query.trim().length === 0
      ? members
      : members.filter((u) => {
          const q = query.trim().toLowerCase()
          return (
            (u.name ?? "").toLowerCase().includes(q) ||
            (u.username ?? "").toLowerCase().includes(q)
          )
        })

  function toggle(id: string) {
    setChecked((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  return (
    <div className="flex min-h-[60vh] flex-col">
      {/* Deliberately NOT sticky. Pinning this block kept the Back/OK row and the search
          field hovering over the grid for the whole scroll, which read as a floating bar
          sitting on top of the people rather than part of the list. It scrolls away with
          the content now — scroll back up to search. */}
      <div className="flex flex-col gap-3 bg-background pb-3">
        <div className="flex items-center justify-between gap-2">
          <Button type="button" variant="ghost" size="sm" onClick={onBack}>
            <ArrowLeft className="mr-1 h-4 w-4" aria-hidden="true" />
            Back
          </Button>
          <Button type="button" size="sm" onClick={() => onConfirm([...checked])}>
            OK
          </Button>
        </div>
        <Input
          aria-label="Search people"
          placeholder="Search people…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      </div>

      {isLoading ? (
        <p className="py-16 text-center text-sm text-muted-foreground">Loading…</p>
      ) : filtered.length === 0 ? (
        <p className="py-16 text-center text-sm text-muted-foreground">No members found.</p>
      ) : (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          {filtered.map((user) => {
            const isChecked = checked.has(user.id)
            const initials = ((user.name || "?")[0] ?? "?").toUpperCase()
            return (
              <button
                key={user.id}
                type="button"
                aria-pressed={isChecked}
                onClick={() => toggle(user.id)}
                className={cn(
                  "relative isolate overflow-hidden flex flex-col items-center gap-2 rounded-lg border bg-card p-4 text-center transition-[transform,border-color,box-shadow] duration-150 ease-[cubic-bezier(0.22,1,0.36,1)] active:scale-[0.97]",
                  isChecked ? "ring-2 ring-primary" : "hover:border-primary/30"
                )}
              >
                <CardBackground variant={user.equippedBackground} />
                {user.equippedBackground && (
                  <div className="absolute inset-0 z-[1] bg-background/70" />
                )}
                <MaxxerTrophy count={user._count.termsWon} size="sm" />
                {/* Selection check moves to the left corner here: the trophy is
                    identity and sits in the same corner on every profile surface,
                    while the check is transient state. */}
                {isChecked && (
                  <span className="animate-in zoom-in-50 fade-in-0 duration-150 ease-[cubic-bezier(0.22,1,0.36,1)] absolute left-2 top-2 z-10 flex h-5 w-5 items-center justify-center rounded-full bg-primary text-primary-foreground">
                    <Check className="h-3 w-3" aria-hidden="true" />
                  </span>
                )}
                <div className="relative z-10">
                  <UserAvatar
                    userId={user.id}
                    image={user.image}
                    name={user.name}
                    ring={user.equippedRing}
                    size={48}
                    fallback={<span className="text-base font-semibold">{initials}</span>}
                  />
                </div>
                <div className="relative z-10 w-full min-w-0">
                  <p className="truncate text-sm font-medium leading-tight">{user.name ?? "Unnamed"}</p>
                  <TitleChip slug={user.equippedTitle} />
                  {user.username && (
                    <p className="truncate text-xs text-muted-foreground">@{user.username}</p>
                  )}
                  <p className="mt-1 text-xs font-semibold tabular-nums font-mono">
                    {user.zigmaPoints} ZP
                  </p>
                </div>
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}
