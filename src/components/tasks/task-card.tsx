"use client"

// TaskCard — displays a single Task Post in the /tasks list or /tasks/[id] page.
// No voting UI (tasks are not voteable — D-08).
// Shows zpReward badge, "Task" label, admin avatar/name, reply count link → /tasks/[id].
//
// Security: T-6-15 — explicit select in parent (admin limited to id/name/image; no password/email).

import Link from "next/link"
import { MessageSquare, Coins, Trophy, Lock, Ban } from "lucide-react"
import { Card, CardHeader, CardContent, CardFooter } from "@/components/ui/card"
import { EditTaskModal } from "@/components/tasks/edit-task-modal"
import { ImageCarousel } from "@/components/ui/image-carousel"

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface TaskCardProps {
  id: string
  title: string
  description: string
  zpReward: number | null
  mediaUrl?: string | null
  images?: string[]
  createdAt: Date
  admin: { id: string; name: string | null; image: string | null }
  replyCount?: number
  // Position in its list — drives the staggered entrance delay (mirrors PostCard)
  index?: number
  // Betting pool fields (kind === "BET"). Default STANDARD keeps existing callers intact.
  kind?: "STANDARD" | "BET"
  minBet?: number | null
  betsCloseAt?: Date | null
  winningChoice?: string | null
  betSettled?: boolean
  // Admin-only affordance: shows the edit pencil. Locked/settled pools hide it
  // (the server rejects those edits regardless).
  canEdit?: boolean
}

// ---------------------------------------------------------------------------
// Helpers (copied verbatim from post-card.tsx — do not reimplement)
// ---------------------------------------------------------------------------

function formatRelativeTime(date: Date): string {
  const now = Date.now()
  const diffMs = now - date.getTime()
  const diffSeconds = Math.round(diffMs / 1000)
  const diffMinutes = Math.round(diffSeconds / 60)
  const diffHours = Math.round(diffMinutes / 60)
  const diffDays = Math.round(diffHours / 24)

  const rtf = new Intl.RelativeTimeFormat("en", { numeric: "auto" })

  if (Math.abs(diffSeconds) < 60) return rtf.format(-diffSeconds, "second")
  if (Math.abs(diffMinutes) < 60) return rtf.format(-diffMinutes, "minute")
  if (Math.abs(diffHours) < 24) return rtf.format(-diffHours, "hour")
  return rtf.format(-diffDays, "day")
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function TaskCard({
  id,
  title,
  description,
  zpReward,
  mediaUrl,
  images = [],
  createdAt,
  admin,
  replyCount,
  index = 0,
  kind = "STANDARD",
  minBet,
  betsCloseAt,
  winningChoice,
  betSettled = false,
  canEdit = false,
}: TaskCardProps) {
  const adminName = admin.name ?? "Admin"
  const isBet = kind === "BET"
  // A cancelled pool is settled with no winning choice (bet.cancelBet refunded every
  // stake) — same "still readable, drained of colour" treatment as a cancelled post.
  const betCancelled = isBet && betSettled && !winningChoice
  // ponytail: deliberate wall-clock read during render, rule suppressed rather than
  // engineered away. betLocked only gates whether the Edit affordance shows, and the
  // value is inherently a snapshot — the button would not disappear mid-view without a
  // re-render regardless of how the time is sourced. The "pure" alternatives are an
  // interval re-rendering every task card on a timer, or threading `now` down from a
  // parent that has the identical impurity. Neither buys correctness here.
  // Upgrade path: if a live lock-out countdown is ever wanted, replace this with a
  // shared ticking clock context rather than a per-card interval.
  // eslint-disable-next-line react-hooks/purity
  const betLocked = !betSettled && betsCloseAt != null && betsCloseAt.getTime() <= Date.now()
  const showEdit = canEdit && (!isBet || (!betSettled && !betLocked))
  // Clickable card only in a list (replyCount provided); the detail page passes
  // undefined so the card at the top never links to itself. Mirrors PostCard.
  const isClickable = typeof replyCount === "number"

  return (
    <Card
      className={`group relative animate-card-rise transition-[transform,border-color,box-shadow,opacity] duration-200 ease-[cubic-bezier(0.22,1,0.36,1)] hover:-translate-y-0.5 hover:border-primary/30 hover:shadow-md${
        betCancelled ? " opacity-60 grayscale hover:opacity-100 hover:border-border hover:shadow-none" : ""
      }`}
      style={{ "--i": index % 6 } as React.CSSProperties}
    >
      <CardHeader className="pb-3">
        <div className="flex flex-wrap items-center gap-2">
          {isBet ? (
            <>
              {/* Betting Pool label — primary tint + coin icon */}
              <span className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-semibold text-primary bg-primary/10">
                <Coins className="h-3 w-3" aria-hidden="true" />
                Betting Pool
              </span>
              {betCancelled ? (
                <span className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-semibold text-muted-foreground bg-muted ml-auto">
                  <Ban className="h-3 w-3" aria-hidden="true" />
                  Cancelled
                </span>
              ) : betSettled ? (
                <span className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-semibold text-emerald-700 dark:text-emerald-400 bg-emerald-500/10 ml-auto">
                  <Trophy className="h-3 w-3" aria-hidden="true" />
                  {winningChoice ? `${winningChoice} won` : "Settled"}
                </span>
              ) : betLocked ? (
                <span className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-semibold text-amber-700 dark:text-amber-400 bg-amber-500/10 ml-auto">
                  <Lock className="h-3 w-3" aria-hidden="true" />
                  Bets locked
                </span>
              ) : (
                <span className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-semibold text-muted-foreground bg-muted ml-auto">
                  Open · min {minBet ?? 1} ZP
                </span>
              )}
            </>
          ) : (
            <>
              {/* "Activity" label badge — muted, no icon (D-08: no vote UI) */}
              <span className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-semibold text-muted-foreground bg-muted">
                Activity
              </span>

              {/* ZP reward badge — emerald (UI-SPEC color contract) */}
              {zpReward != null && (
                <span className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-semibold text-emerald-600 bg-emerald-50 ml-auto">
                  {zpReward} ZP
                </span>
              )}
            </>
          )}

          {/* Admin edit — pencil at the end of the badge row. z-10 keeps it
              clickable above the stretched card link. */}
          {showEdit && (
            <span className="relative z-10 inline-flex">
              <EditTaskModal
                task={{
                  id,
                  kind,
                  title,
                  description,
                  zpReward,
                  minBet: minBet ?? null,
                  betsCloseAt: betsCloseAt ?? null,
                }}
              />
            </span>
          )}
        </div>

        <div className="flex items-center gap-2 mt-1">
          <span className="text-sm text-muted-foreground">
            <span className="font-medium text-foreground">{adminName}</span>
          </span>
        </div>
      </CardHeader>

      <CardContent className="pb-3">
        {/* Title — stretched link in a list (::after overlay opens the detail
            page); plain text on the detail page itself. Matches PostCard. */}
        {isClickable ? (
          <Link
            href={`/tasks/${id}`}
            className="text-base font-semibold after:absolute after:inset-0 after:rounded-lg after:content-[''] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 rounded-sm"
          >
            {title}
          </Link>
        ) : (
          <p className="text-base font-semibold">{title}</p>
        )}
        <p className="mt-1 text-sm text-muted-foreground">{formatRelativeTime(createdAt)}</p>

        {/* Description */}
        <p className="mt-2 text-sm text-muted-foreground">{description}</p>

      </CardContent>

      {/* Attachments — divider above (here), footer's border-t below. z-10 keeps
          it interactive over the stretched card link. */}
      {images.length > 0 && (
        <div className="relative z-10 border-t px-6 py-3">
          <ImageCarousel images={images} alt={title} />
        </div>
      )}

      {(isBet || typeof replyCount === "number") && (
        <CardFooter className="flex flex-col gap-2 border-t pt-2">
          {betCancelled && (
            // Says out loud what the grey already implies — the badge alone doesn't
            // tell you the stakes came back. Mirrors PostCard's cancelled note.
            <p className="w-full text-xs text-muted-foreground text-pretty">
              An admin cancelled this pool. Every stake was refunded and no bets can be placed.
            </p>
          )}
          {isBet && (
            /* Bet CTA → /tasks/[id] where BetPanel lives. z-10 above the card link. */
            <div className="relative z-10 flex w-full items-center">
              <Link
                href={`/tasks/${id}`}
                className="inline-flex items-center gap-1.5 rounded-full border border-primary/40 bg-primary/10 px-3 py-1 text-sm font-medium text-primary transition-[transform,background-color,border-color,color] duration-150 ease-[cubic-bezier(0.22,1,0.36,1)] active:scale-95 hover:bg-primary/20 min-h-[44px]"
              >
                <Coins className="h-3.5 w-3.5" aria-hidden="true" />
                {betCancelled
                  ? "See the pool"
                  : betSettled
                  ? "See result"
                  : betLocked
                  ? "See the pool"
                  : "Place your bet"}
              </Link>
            </div>
          )}
          {typeof replyCount === "number" && (
            /* Reply count as text, not a button — click the card to open replies. */
            <div className="flex w-full items-center text-sm text-muted-foreground">
              <span className="inline-flex items-center gap-1.5">
                <MessageSquare className="h-3.5 w-3.5" aria-hidden="true" />
                {replyCount === 0
                  ? "No replies"
                  : `${replyCount} ${replyCount === 1 ? "reply" : "replies"}`}
              </span>
            </div>
          )}
        </CardFooter>
      )}
    </Card>
  )
}
