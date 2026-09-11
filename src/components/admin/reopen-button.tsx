"use client"

// The way back in, rendered on the closed-door screen for admins only.
//
// This is the ONLY client component on /downtime, and it is mounted only when the
// viewer is an admin — the page's "no client JS by design" property is intact for
// everyone else, who still gets markup and a stylesheet and nothing that can change
// state. That is what makes this safe to put on the closed door at all.
//
// It clears the override to FORCED OPEN rather than to AUTO: an admin pressing "reopen"
// during the interim means "open it now", and AUTO would immediately close it again.

import { useState } from "react"
import { useMutation } from "@tanstack/react-query"
import { Loader2 } from "lucide-react"
import { useTRPC } from "@/trpc/client"
import { Button } from "@/components/ui/button"

export function ReopenButton() {
  const trpc = useTRPC()
  const [done, setDone] = useState(false)
  const reopen = useMutation(
    trpc.admin.setDowntime.mutationOptions({
      onSuccess: () => setDone(true),
      onError: () => setDone(false),
    }),
  )

  if (done) {
    return (
      <div className="mt-10 rounded-xl border border-border/70 bg-card/60 p-4 backdrop-blur-sm">
        <p className="text-sm font-medium">Reopening…</p>
        <p className="mt-1 text-xs text-muted-foreground">
          Takes up to ~15s to reach every server. Refresh after that.
        </p>
      </div>
    )
  }

  return (
    <div className="mt-10 rounded-xl border border-border/70 bg-card/60 p-4 backdrop-blur-sm">
      <p className="text-xs font-medium uppercase tracking-widest text-muted-foreground">
        Admin
      </p>
      <Button
        className="mt-3 w-full"
        disabled={reopen.isPending}
        onClick={() => reopen.mutate({ forcedDown: false })}
      >
        {reopen.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />}
        Reopen Zigma Points
      </Button>
      {reopen.isError && (
        <p role="alert" className="mt-2 text-xs text-destructive">
          {reopen.error.message || "Couldn't reopen."}
        </p>
      )}
    </div>
  )
}
