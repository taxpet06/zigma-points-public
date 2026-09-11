"use client"

// AdminDowntimePanel — open or close Zigma Points by hand.
//
// The term schedule is still the default and is unchanged: closed in the gap between
// terms, open inside one. This panel is how an admin DISAGREES with that schedule, so
// the interim no longer implies downtime — it merely defaults to it.
//
// Three states, and the panel always names which one is in force and what the schedule
// would say underneath it, because "closed" alone is ambiguous once an override exists.

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { toast } from "sonner"
import { Loader2 } from "lucide-react"
import { useTRPC } from "@/trpc/client"
import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { FeedSkeleton } from "@/components/feed/feed-skeleton"

export function AdminDowntimePanel() {
  const trpc = useTRPC()
  const queryClient = useQueryClient()
  const { data, isPending } = useQuery(trpc.admin.downtimeStatus.queryOptions())

  const setDowntime = useMutation(
    trpc.admin.setDowntime.mutationOptions({
      onSuccess: (res) => {
        toast.success(
          res.forcedDown === null
            ? "Following the term schedule again"
            : res.forcedDown
              ? "Zigma Points is closing"
              : "Zigma Points is opening",
          { description: "Takes up to ~15s to apply everywhere." },
        )
        void queryClient.invalidateQueries(trpc.admin.downtimeStatus.queryFilter())
      },
      onError: (e) => toast.error(e.message || "Couldn't change that."),
    }),
  )

  if (isPending || !data) return <FeedSkeleton count={2} />

  const { down, scheduledDown, forcedDown } = data
  const busy = setDowntime.isPending
  const set = (forcedDown: boolean | null) => setDowntime.mutate({ forcedDown })

  return (
    <div className="flex flex-col gap-4">
      {/* Current verdict. The dot is the same status vocabulary the rest of the admin
          tables use — destructive for closed, primary for open — not a new palette. */}
      <div className="rounded-lg border p-4">
        <div className="flex items-center gap-2">
          <span
            aria-hidden="true"
            className={cn(
              "h-2.5 w-2.5 rounded-full",
              down ? "bg-destructive" : "bg-emerald-500",
            )}
          />
          <p className="text-sm font-semibold">
            Zigma Points is {down ? "closed" : "open"}
          </p>
        </div>
        <p className="mt-1.5 text-xs text-muted-foreground">
          {forcedDown === null ? (
            <>
              Following the term schedule
              {scheduledDown ? " — between terms, so closed." : " — inside a term, so open."}
            </>
          ) : (
            <>
              Manually {forcedDown ? "closed" : "opened"} by an admin, overriding the
              schedule (which says{" "}
              <span className="font-medium">{scheduledDown ? "closed" : "open"}</span>).
            </>
          )}
        </p>
      </div>

      <div className="flex flex-wrap gap-2">
        {down ? (
          <Button onClick={() => set(false)} disabled={busy}>
            {busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />}
            Open Zigma Points
          </Button>
        ) : (
          <Button variant="destructive" onClick={() => set(true)} disabled={busy}>
            {busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />}
            Close Zigma Points
          </Button>
        )}
        {forcedDown !== null && (
          <Button variant="outline" onClick={() => set(null)} disabled={busy}>
            Follow the term schedule
          </Button>
        )}
      </div>

      <p className="text-xs text-muted-foreground">
        Closing freezes the whole app for everyone else — the feed, ZP, games and sign-in
        all stop, and every page becomes the closed-door screen. Admins keep this portal
        either way, and can reopen from the closed-door screen itself. Changes take up to
        ~15s to reach every server.
      </p>
    </div>
  )
}
