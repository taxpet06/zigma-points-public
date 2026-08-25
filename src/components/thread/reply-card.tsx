"use client"

// ReplyCard — single reply card with avatar/name/timestamp/content/media + Reply button.
// Renders recursively with depth-capped visual indentation (max 4 levels).
//
// Security: T-05-08 — React escapes text content by default; no dangerouslySetInnerHTML used.

import { Reply } from "lucide-react"
import { Card, CardContent, CardHeader } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { cn, formatRelativeTime } from "@/lib/utils"
import type { ReplyNode } from "@/components/thread/reply-thread"

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const MAX_VISUAL_DEPTH = 4

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

interface ReplyCardProps {
  reply: ReplyNode
  depth: number
  onReply: (authorUsername: string, replyId: string) => void
}

export function ReplyCard({ reply, depth, onReply }: ReplyCardProps) {
  const displayName = reply.author.name ?? reply.author.username ?? "Unknown"

  return (
    <div>
      <Card className="mb-2 animate-card-rise">
        <CardHeader className="pb-2">
          <div className="flex items-center gap-2 min-w-0">
            <span className="text-sm font-medium truncate">{displayName}</span>
            {reply.author.username && (
              <span className="text-xs text-muted-foreground truncate max-w-[6rem] shrink-0">@{reply.author.username}</span>
            )}
            <span className="text-xs text-muted-foreground ml-auto shrink-0 whitespace-nowrap pl-1">
              {formatRelativeTime(reply.createdAt)}
            </span>
          </div>
        </CardHeader>

        <CardContent className="pt-0 pb-2">
          <p className="text-sm break-words text-pretty">{reply.content}</p>


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

      {/* Recursive children — children array is always [] (never undefined), safe to map */}
      {reply.children.length > 0 && (
        <div
          className={cn(
            "pl-4 border-l border-border",
            depth >= MAX_VISUAL_DEPTH && "pl-0"
          )}
        >
          {reply.children.map((child) => (
            <ReplyCard
              key={child.id}
              reply={child}
              depth={depth + 1}
              onReply={onReply}
            />
          ))}
        </div>
      )}
    </div>
  )
}
