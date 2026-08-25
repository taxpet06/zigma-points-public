"use client"

import { useRef } from "react"
import { Check, X } from "lucide-react"
import { Button } from "@/components/ui/button"

// Quick scale "pop" to acknowledge a cast/retract. Uses the Web Animations API so
// it re-fires on every press without remounting (preserving focus), and is skipped
// entirely for users who prefer reduced motion.
function pop(el: HTMLElement | null) {
  if (!el) return
  if (typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches) return
  el.animate(
    [{ transform: "scale(1)" }, { transform: "scale(1.1)" }, { transform: "scale(1)" }],
    { duration: 260, easing: "cubic-bezier(0.22, 1, 0.36, 1)" }
  )
}

interface VoteButtonsProps {
  agreeCount: number
  disagreeCount: number
  userVote: { type: "AGREE" | "DISAGREE" } | null
  isVotingOpen: boolean
  isPending: boolean
  onVote: (type: "AGREE" | "DISAGREE") => void
  onRetract: () => void
}

export function VoteButtons({
  agreeCount,
  disagreeCount,
  userVote,
  isVotingOpen,
  isPending,
  onVote,
  onRetract,
}: VoteButtonsProps) {
  const userVoteType = userVote?.type ?? null
  const agreeRef = useRef<HTMLButtonElement>(null)
  const disagreeRef = useRef<HTMLButtonElement>(null)

  if (!isVotingOpen) {
    return (
      <div className="flex w-full items-center justify-between">
        <span className="text-sm text-muted-foreground tabular-nums">
          Pass: {agreeCount.toLocaleString()}&nbsp;&nbsp;Fail: {disagreeCount.toLocaleString()}
        </span>
      </div>
    )
  }

  return (
    <div className="flex w-full items-center gap-2">
      <Button
        ref={agreeRef}
        variant={userVoteType === "AGREE" ? "default" : "outline"}
        size="default"
        className="flex-1"
        disabled={isPending}
        aria-pressed={userVoteType === "AGREE"}
        aria-label={`Vote Pass (${agreeCount} votes)`}
        onClick={() => {
          pop(agreeRef.current)
          if (userVoteType === "AGREE") onRetract()
          else onVote("AGREE")
        }}
      >
        <Check className="h-4 w-4 mr-1" aria-hidden="true" /> Pass ({agreeCount.toLocaleString()})
      </Button>
      <Button
        ref={disagreeRef}
        variant={userVoteType === "DISAGREE" ? "destructive" : "outline"}
        size="default"
        className="flex-1"
        disabled={isPending}
        aria-pressed={userVoteType === "DISAGREE"}
        aria-label={`Vote Fail (${disagreeCount} votes)`}
        onClick={() => {
          pop(disagreeRef.current)
          if (userVoteType === "DISAGREE") onRetract()
          else onVote("DISAGREE")
        }}
      >
        <X className="h-4 w-4 mr-1" aria-hidden="true" /> Fail ({disagreeCount.toLocaleString()})
      </Button>
    </div>
  )
}
