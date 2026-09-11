"use client"

import { useState } from "react"
import Link from "next/link"
import {
  ArrowUpCircle,
  ArrowDownCircle,
  Ban,
  Clock,
  CheckCircle2,
  XCircle,
  MessageSquare,
  FileText,
} from "lucide-react"
import { Card, CardHeader, CardContent, CardFooter } from "@/components/ui/card"
import { cn, formatRelativeTime } from "@/lib/utils"
import { VoteButtons } from "@/components/feed/vote-buttons"
import { ImageCarousel } from "@/components/ui/image-carousel"

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface PostCardProps {
  id: string
  // REGULAR is a plain social post: no targets, no ZP, no vote, no voting window. It shares
  // this card so the feed stays one component — the point-request chrome is switched off
  // below rather than duplicated into a near-identical second card.
  type: "AWARD" | "DEDUCT" | "REGULAR"
  title: string
  zpAmount: number
  outcome: string | null
  settled: boolean
  votingEndsAt: Date
  createdAt: Date
  explanation?: string | null
  author: { id: string; name: string | null; image: string | null }
  // One or more target users (M-01). Each receives zpAmount individually if the post passes.
  targets: { id: string; name: string | null; image: string | null }[]

  // Vote display
  agreeCount?: number
  disagreeCount?: number
  userVote?: { type: "AGREE" | "DISAGREE" } | null

  // Vote interaction (provided by FeedList; absent on profile/history views)
  currentUserId?: string | undefined
  onVote?: (type: "AGREE" | "DISAGREE") => void
  onRetract?: () => void
  isPending?: boolean

  // Admin cancel (provided by FeedList/PostDetail for ADMIN sessions only).
  // Purely an affordance — post.cancelPost re-verifies the role server-side.
  onCancel?: () => void
  isCancelling?: boolean

  // Other optional props
  mediaUrl?: string
  images?: string[]
  replyCount?: number

  // Position in its list — drives the staggered entrance delay
  index?: number
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function PostCard({
  id,
  type,
  title,
  zpAmount,
  outcome,
  settled,
  votingEndsAt,
  createdAt,
  explanation,
  author,
  targets,
  agreeCount,
  disagreeCount,
  userVote,
  currentUserId,
  onVote,
  onRetract,
  isPending,
  onCancel,
  isCancelling,
  mediaUrl,
  images = [],
  replyCount,
  index = 0,
}: PostCardProps) {
  const isAward = type === "AWARD"
  const isDeduct = type === "DEDUCT"
  const isRegular = type === "REGULAR"
  // A cancelled post is settled with outcome "Cancelled" — no ZP moved, no votes accepted.
  const isCancelled = settled && outcome === "Cancelled"
  const [confirmCancel, setConfirmCancel] = useState(false)
  // Clickable card only in a list (replyCount provided); the detail page passes
  // undefined so the card at the top never links to itself.
  const isClickable = typeof replyCount === "number"

  const typeBadgeClasses = cn(
    "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-semibold",
    {
      "text-emerald-700 bg-emerald-50 dark:text-emerald-400 dark:bg-emerald-950/50": isAward,
      "text-amber-700 bg-amber-50 dark:text-amber-400 dark:bg-amber-950/50": isDeduct,
      // Brand crimson, from the token — not a rose-* palette step, which would be chroma
      // creep off the one committed brand colour (DESIGN.md § No Chroma Creep). Award and
      // Deduct are emerald/amber because those types carry an OUTCOME; a Regular post has
      // no outcome, so the badge is pure identity and brand crimson is the right channel
      // rather than a Semantic First violation.
      //
      // Dark mode cannot reuse --primary for the text: at L=0.53 on the L=0.205 card it
      // lands near 2.8:1, under the 4.5:1 floor for text this small. --ring is the SAME
      // crimson brightened to L=0.68 exactly for dark surfaces (DESIGN.md § Dark Mode), so
      // it is the token to reach for here — the odd-sounding name is the palette's, not a
      // repurposing. The fill stays --primary-derived in both modes; --accent goes neutral
      // grey in dark, which is the very greyness being fixed.
      "text-primary bg-primary/10 dark:text-ring dark:bg-primary/20": isRegular,
      "text-muted-foreground bg-muted": !isAward && !isDeduct && !isRegular,
    }
  )

  const TypeIcon = isAward ? ArrowUpCircle : isDeduct ? ArrowDownCircle : isRegular ? FileText : ArrowUpCircle
  const typeBadgeLabel = isAward ? "Award" : isDeduct ? "Deduct" : isRegular ? "Post" : type
  const typeBadgeAriaLabel = isAward ? "Award post" : isDeduct ? "Deduct post" : isRegular ? "Regular post" : "Activity post"

  // A Regular post is stored settled (nothing to settle), so every branch below would
  // otherwise resolve to a meaningless "Settled" chip. It has no outcome to report at all.
  let outcomeBadge: React.ReactNode
  if (isRegular) {
    outcomeBadge = null
  } else if (isCancelled) {
    outcomeBadge = (
      <span className="inline-flex items-center gap-1 text-sm text-muted-foreground">
        <Ban className="h-4 w-4" />
        Cancelled
      </span>
    )
  } else if (!settled) {
    outcomeBadge = (
      <span className="inline-flex items-center gap-1 text-sm text-amber-600 dark:text-amber-400">
        <Clock className="h-4 w-4" />
        Pending
      </span>
    )
  } else if (outcome === "Awarded") {
    outcomeBadge = (
      <span className="inline-flex items-center gap-1 text-sm text-emerald-600 dark:text-emerald-400">
        <CheckCircle2 className="h-4 w-4" />
        Passed
      </span>
    )
  } else if (outcome === "Rejected") {
    outcomeBadge = (
      <span className="inline-flex items-center gap-1 text-sm text-muted-foreground">
        <XCircle className="h-4 w-4" />
        Rejected
      </span>
    )
  } else if (settled) {
    outcomeBadge = (
      <span className="inline-flex items-center gap-1 text-sm text-muted-foreground">
        <CheckCircle2 className="h-4 w-4" />
        Settled
      </span>
    )
  } else {
    outcomeBadge = null
  }

  const authorName = author.name ?? "Unknown"
  const targetNames = targets.map((t) => t.name ?? "Unknown")
  // Show up to 3 target names inline, then "+N more" so cards stay compact.
  const targetDisplay =
    targetNames.length <= 3
      ? targetNames.join(", ")
      : `${targetNames.slice(0, 3).join(", ")} +${targetNames.length - 3} more`
  const multiTarget = targets.length > 1

  // "Still taking votes" — the same test the server applies in castVote/retractVote/
  // cancelPost. Both halves matter: settlement runs on an external cron, so a post
  // past its window sits at settled:false until that cron catches up. Anything gated
  // on `!settled` alone stays live during that gap.
  const isPostOpen = !settled && !!votingEndsAt && new Date() < new Date(votingEndsAt)

  // Vote buttons are shown only when interaction props are provided (feed view). Never on a
  // Regular post: there is no proposal to agree or disagree with.
  const canShowVoteButtons = !isRegular && !!onVote && !!onRetract
  const isVotingOpen = canShowVoteButtons && isPostOpen && currentUserId !== author.id

  // Cancel is offered by callers for ADMIN sessions; whether the post is *cancellable*
  // is decided here, once, so the two call sites can't drift. Admins may cancel their
  // own posts, so no author exclusion.
  const canCancel = !!onCancel && isPostOpen

  return (
    <Card
      className={cn(
        "group relative animate-card-rise transition-[transform,border-color,box-shadow,opacity] duration-200 ease-[cubic-bezier(0.22,1,0.36,1)] hover:-translate-y-0.5 hover:border-primary/30 hover:shadow-md",
        // Cancelled: drained of colour and dimmed, but still readable and still
        // clickable through to its thread. Lifts back toward full opacity on hover
        // so the content stays legible when you actually go to read it.
        isCancelled && "opacity-60 grayscale hover:opacity-100 hover:border-border hover:shadow-none",
      )}
      style={{ "--i": index % 6 } as React.CSSProperties}
    >
      <CardHeader className="pb-3">
        <div className="flex flex-wrap items-center gap-2">
          <span className={typeBadgeClasses} aria-label={typeBadgeAriaLabel}>
            <TypeIcon className="h-3.5 w-3.5" aria-hidden="true" />
            {typeBadgeLabel}
          </span>
          {/* No ZP line on a Regular post — it moves none, and a "0 ZP" chip would read
              as a point request that happens to be worth nothing. */}
          {!isRegular && (
            <span
              className={cn(
                "text-sm font-semibold font-mono tabular-nums",
                // Struck through on a cancelled post: this ZP was never moved.
                isCancelled && "line-through text-muted-foreground",
              )}
            >
              {isAward ? "+" : isDeduct ? "-" : ""}
              {zpAmount} ZP{multiTarget ? " each" : ""}
            </span>
          )}
          <span className="ml-auto">{outcomeBadge}</span>
        </div>

        <div className="flex items-center gap-2 mt-1 min-w-0">
          <span className="text-sm text-muted-foreground break-words min-w-0">
            <span className="font-medium text-foreground">{authorName}</span>
            {/* "author → targets" is the nomination arrow. A Regular post has no targets,
                so it shows the author alone. */}
            {!isRegular && (
              <>
                {" → "}
                <span className="font-medium text-foreground">{targetDisplay}</span>
              </>
            )}
          </span>
        </div>
      </CardHeader>

      <CardContent className="pb-3">
        {/* In a list (replyCount provided) the title is a stretched link: the
            ::after overlay makes the whole card open the thread. On the detail
            page (replyCount undefined) it's plain text — no self-link. Interactive
            controls below opt back out with `relative z-10`. */}
        {isClickable ? (
          <Link
            href={`/post/${id}`}
            className="text-base font-semibold break-words after:absolute after:inset-0 after:rounded-lg after:content-[''] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 rounded-sm"
          >
            {title}
          </Link>
        ) : (
          <p className="text-base font-semibold break-words">{title}</p>
        )}
        <p className="mt-1 text-sm text-muted-foreground">{formatRelativeTime(createdAt)}</p>
        {explanation && (
          <p className="mt-2 text-sm text-muted-foreground break-words text-pretty">{explanation}</p>
        )}

      </CardContent>

      {/* Attachments — bracketed by a divider above (here) and the footer's
          border-t below. z-10 lifts it over the stretched card link. */}
      {images.length > 0 && (
        <div className="relative z-10 border-t px-6 py-3">
          <ImageCarousel images={images} alt={title} />
        </div>
      )}

      {(canShowVoteButtons || canCancel || typeof replyCount === "number" || (!settled && !!votingEndsAt)) && (
      <CardFooter className="flex flex-col gap-2 border-t pt-2">
        {isCancelled && (
          // Says out loud what the grey already implies — the outcome badge alone
          // doesn't tell you the ZP never moved.
          <p className="w-full text-xs text-muted-foreground text-pretty">
            An admin cancelled this post. No ZP was awarded or deducted, and voting is closed.
          </p>
        )}
        {canShowVoteButtons && isVotingOpen && (
          // Plain-language guide so first-timers know what their vote does to the ZP.
          <p className="w-full text-xs text-muted-foreground text-pretty">
            {isAward
              ? `Pass gives them +${zpAmount} ZP. Fail rejects it.`
              : `Pass docks them ${zpAmount} ZP. Fail rejects it.`}
          </p>
        )}
        {canShowVoteButtons && (
          // Above the stretched card link so voting never triggers navigation.
          <div className="relative z-10 w-full">
            <VoteButtons
              agreeCount={agreeCount ?? 0}
              disagreeCount={disagreeCount ?? 0}
              userVote={userVote ?? null}
              isVotingOpen={isVotingOpen}
              isPending={isPending ?? false}
              onVote={onVote}
              onRetract={onRetract}
            />
          </div>
        )}
        {(typeof replyCount === "number" || (!settled && votingEndsAt)) && (
          <div className="flex w-full items-center justify-between gap-3 text-sm text-muted-foreground">
            {typeof replyCount === "number" ? (
              <span className="inline-flex items-center gap-1.5">
                <MessageSquare className="h-3.5 w-3.5" aria-hidden="true" />
                {replyCount === 0
                  ? "No replies"
                  : `${replyCount} ${replyCount === 1 ? "reply" : "replies"}`}
              </span>
            ) : (
              <span />
            )}
            {!settled && votingEndsAt && (
              <span className="inline-flex items-center gap-1.5">
                <Clock className="h-3.5 w-3.5" aria-hidden="true" />
                Voting ends {new Date(votingEndsAt).toLocaleString(undefined, {
                  month: "short",
                  day: "numeric",
                  hour: "numeric",
                  minute: "2-digit",
                })}
              </span>
            )}
          </div>
        )}
        {canCancel && onCancel && (
          // Admin-only affordance, and ONLY an affordance: post.cancelPost re-reads the
          // caller's role from the DB and re-tests that the post is open, so hiding this
          // button is cosmetic, not the control. Inline confirm mirrors user-table.tsx.
          // z-10 lifts it over the stretched card link so it never navigates.
          <div className="relative z-10 flex w-full justify-end">
            {confirmCancel ? (
              <div className="flex items-center gap-2">
                <span className="text-xs text-muted-foreground">Cancel this post?</span>
                <button
                  type="button"
                  className="text-xs font-semibold text-destructive disabled:opacity-50"
                  disabled={isCancelling}
                  onClick={() => onCancel()}
                >
                  {isCancelling ? "Cancelling…" : "Yes"}
                </button>
                <span className="text-xs text-muted-foreground">/</span>
                <button
                  type="button"
                  className="text-xs text-muted-foreground disabled:opacity-50"
                  disabled={isCancelling}
                  onClick={() => setConfirmCancel(false)}
                >
                  No
                </button>
              </div>
            ) : (
              <button
                type="button"
                className="inline-flex items-center gap-1.5 text-xs text-muted-foreground transition-colors hover:text-destructive"
                onClick={() => setConfirmCancel(true)}
                aria-label={`Cancel post: ${title}`}
              >
                <Ban className="h-3.5 w-3.5" aria-hidden="true" />
                Cancel post
              </button>
            )}
          </div>
        )}
      </CardFooter>
      )}
    </Card>
  )
}
