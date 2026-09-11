"use client"

// TaskReplyCard — single reply card inside a betting pool's thread. Mirrors
// reply-card.tsx (the Posts one) and stays a separate file for the same
// clone-don't-abstract reason the two threads are separate.
//
// It used to carry the Activities completion badge and the admin "Mark Complete"
// button; both went with the Activities feature, and BET pools pay out through
// bet.settleBet, never through a per-reply award.
//
// Security:
//   T-6-13 — React escapes text content by default; no dangerouslySetInnerHTML used

import { Reply } from "lucide-react"
import { Card, CardContent, CardHeader } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import type { TaskReplyNode } from "@/components/tasks/task-thread"

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
// Constants
// ---------------------------------------------------------------------------

const MAX_VISUAL_DEPTH = 4

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

interface TaskReplyCardProps {
  reply: TaskReplyNode
  taskId: string  // explicit required prop — sourced from the task page, not from reply.taskId (WR-02)
  depth: number
  onReply: (authorUsername: string, replyId: string) => void
  /** Past term: the thread is read-only (see reply.createReply). */
  closed?: boolean
}

export function TaskReplyCard({ reply, taskId, depth, onReply, closed = false }: TaskReplyCardProps) {
  const displayName = reply.author.name ?? reply.author.username ?? "Unknown"

  return (
    <div>
      <Card className="mb-2 animate-card-rise">
        <CardHeader className="pb-2">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-sm font-medium">{displayName}</span>
            {reply.author.username && (
              <span className="text-xs text-muted-foreground">@{reply.author.username}</span>
            )}
            <span className="text-xs text-muted-foreground ml-auto">
              {formatRelativeTime(reply.createdAt)}
            </span>

          </div>
        </CardHeader>

        <CardContent className="pt-0 pb-2">
          <p className="text-sm">{reply.content}</p>


          {/* Hidden, not disabled, on a closed thread — same reasoning as reply-card.tsx. */}
          {closed ? null : (
          <div className="flex justify-end mt-1">
            <Button
              variant="ghost"
              size="sm"
              aria-label={`Reply to ${reply.author.name ?? reply.author.username ?? "user"}`}
              onClick={() =>
                onReply(reply.author.username ?? reply.author.name ?? "user", reply.id)
              }
            >
              <Reply className="h-3.5 w-3.5 mr-1" aria-hidden="true" />
              Reply
            </Button>
          </div>
          )}
        </CardContent>
      </Card>

      {/* Recursive children — same depth cap + indentation as reply-card.tsx */}
      {reply.children.length > 0 && (
        <div
          className={cn(
            "pl-4 border-l border-border",
            depth >= MAX_VISUAL_DEPTH && "pl-0"
          )}
        >
          {reply.children.map((child) => (
            <TaskReplyCard
              key={child.id}
              reply={child}
              taskId={taskId}
              depth={depth + 1}
              onReply={onReply}
              closed={closed}
            />
          ))}
        </div>
      )}
    </div>
  )
}
