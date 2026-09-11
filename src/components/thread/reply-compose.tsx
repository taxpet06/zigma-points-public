"use client"

// ReplyCompose — pinned compose box on /post/[id] detail page.
// Always visible; shows a dismissible "Replying to @username" banner when parentId is set.
// Media upload reuses postMediaUploader endpoint — no new FileRouter route needed (D-08).
//
// State: controlled from parent (ThreadSection) — parentId/replyingToUsername/onClearParent are props.
// Mutation: NON-OPTIMISTIC (D-10) — waits for server confirmation then invalidates both reply + feed queries.
//
// Security: T-05-10 — createReply is protectedProcedure with authorId from session (Plan 05-01).
//           T-05-09 — orphaned media on failed submit accepted at MVP scale (RESEARCH security domain).

import { useState, useRef } from "react"
import { useMutation, useQueryClient } from "@tanstack/react-query"
import { Loader2, X } from "lucide-react"
import { toast } from "sonner"
import { useTRPC } from "@/trpc/client"
import { Textarea } from "@/components/ui/textarea"
import { Button } from "@/components/ui/button"

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface ReplyComposeProps {
  postId?: string
  taskId?: string
  parentId: string | null
  replyingToUsername: string | null
  onClearParent: () => void
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function ReplyCompose({
  postId,
  taskId,
  parentId,
  replyingToUsername,
  onClearParent,
}: ReplyComposeProps) {
  const trpc = useTRPC()
  const queryClient = useQueryClient()

  const [content, setContent] = useState("")
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  // NON-OPTIMISTIC mutation (D-10) — no onMutate, waits for server confirmation
  const createReply = useMutation(
    trpc.reply.createReply.mutationOptions({
      onSuccess: () => {
        setContent("")
        onClearParent()
        if (taskId) {
          // Task reply: invalidate task replies query (Phase 6)
          void queryClient.invalidateQueries(trpc.task.getTaskReplies.queryFilter({ taskId }))
        } else if (postId) {
          // Post reply: existing Phase 5 invalidations
          void queryClient.invalidateQueries(trpc.reply.getReplies.queryFilter({ postId }))
          void queryClient.invalidateQueries(trpc.post.getFeed.queryFilter())
        }
      },
      onError: () => {
        toast.error("Failed to post reply. Try again.")
      },
    })
  )

  function handleSubmit() {
    if (content.trim().length === 0) return
    createReply.mutate({
      postId: postId,
      taskId: taskId,
      parentId: parentId ?? undefined,
      content: content.trim(),
    })
  }

  return (
    <div id="reply-compose" className="rounded-lg border bg-card p-4 space-y-3">
      {/* "Replying to @username" banner (conditional) */}
      {replyingToUsername && (
        <div className="rounded-md bg-muted px-3 py-1 text-xs text-muted-foreground flex items-center justify-between gap-2">
          <span>Replying to @{replyingToUsername}</span>
          <Button
            variant="ghost"
            size="icon"
            aria-label={`Cancel replying to ${replyingToUsername}`}
            onClick={onClearParent}
          >
            <X className="h-4 w-4" />
          </Button>
        </div>
      )}

      {/* Visually hidden label for accessibility */}
      <label htmlFor="reply-compose-textarea" className="sr-only">
        Reply
      </label>

      <Textarea
        id="reply-compose-textarea"
        ref={textareaRef}
        placeholder="Write a reply…"
        value={content}
        onChange={(e) => setContent(e.target.value)}
        rows={2}
        className="resize-none"
      />

      <div className="flex justify-end">
        <Button
          variant="default"
          disabled={content.trim().length === 0 || createReply.isPending}
          aria-busy={createReply.isPending}
          onClick={handleSubmit}
        >
          {createReply.isPending ? (
            <>
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              Posting…
            </>
          ) : (
            "Post Reply"
          )}
        </Button>
      </div>
    </div>
  )
}
