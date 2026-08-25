"use client"

// TaskReplyCard — single task reply card with completion status badge + Mark Complete button.
// Mirrors reply-card.tsx but adds:
//   - Status badge: Pending (amber) or Awarded (emerald) — visible to all users (TASK-03)
//   - Mark Complete button: admin-only, hidden when already AWARDED (ADMN-03, D-12)
//
// Security:
//   T-6-12 — UI gate: Mark Complete only rendered for session.user.role === "ADMIN" && !isAwarded
//             Server enforces FORBIDDEN on task.completeTask (Plan 06-01 — dual gate)
//   T-6-13 — React escapes text content by default; no dangerouslySetInnerHTML used

import { Reply, CheckCircle2, Clock, Loader2 } from "lucide-react"
import { Card, CardContent, CardHeader } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import { useMutation, useQueryClient } from "@tanstack/react-query"
import { toast } from "sonner"
import { useTRPC } from "@/trpc/client"
import { useSession } from "next-auth/react"
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
}

export function TaskReplyCard({ reply, taskId, depth, onReply }: TaskReplyCardProps) {
  const trpc = useTRPC()
  const queryClient = useQueryClient()
  const { data: session } = useSession()

  const displayName = reply.author.name ?? reply.author.username ?? "Unknown"
  const isAdmin = session?.user?.role === "ADMIN"

  // Completion status derived from author's taskCompletions for this task (TASK-03)
  const completion = reply.author.taskCompletions[0]
  const isAwarded = completion?.status === "AWARDED"

  // Non-optimistic mutation (D-10) — waits for server confirmation (ADMN-03)
  const completeTask = useMutation(
    trpc.task.completeTask.mutationOptions({
      onSuccess: () => {
        toast.success("ZP awarded")
        void queryClient.invalidateQueries(
          trpc.task.getTaskReplies.queryFilter({ taskId })
        )
      },
      onError: () => {
        toast.error("Failed to award ZP. Try again.")
      },
    })
  )

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

            {/* Completion status badge — visible to ALL users (TASK-03) */}
            {isAwarded ? (
              <span
                role="status"
                className="inline-flex items-center gap-1 text-xs font-semibold text-emerald-600 bg-emerald-50 rounded-full px-2 py-0.5"
              >
                <CheckCircle2 className="h-3 w-3" aria-hidden="true" />
                Awarded
              </span>
            ) : completion ? (
              <span
                role="status"
                className="inline-flex items-center gap-1 text-xs text-amber-600 bg-amber-50 rounded-full px-2 py-0.5"
              >
                <Clock className="h-3 w-3" aria-hidden="true" />
                Pending
              </span>
            ) : null}

            {/* Mark Complete button — admin-only + not yet awarded (ADMN-03, D-12, T-6-12) */}
            {isAdmin && !isAwarded && (
              <Button
                variant="default"
                size="sm"
                disabled={completeTask.isPending}
                aria-label={`Mark complete for ${displayName}'s reply`}
                onClick={() =>
                  completeTask.mutate({ taskId, replyId: reply.id })
                }
              >
                {completeTask.isPending ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
                ) : (
                  "Mark Complete"
                )}
              </Button>
            )}
          </div>
        </CardHeader>

        <CardContent className="pt-0 pb-2">
          <p className="text-sm">{reply.content}</p>


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
            />
          ))}
        </div>
      )}
    </div>
  )
}
