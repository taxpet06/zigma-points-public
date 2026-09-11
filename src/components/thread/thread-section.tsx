"use client"

// ThreadSection — client boundary component for /post/[id] detail page.
// Owns lifted parentId/replyingToUsername state shared between ReplyThread and ReplyCompose.
// This component is separate from page.tsx so the page can remain a clean server component.
//
// Interaction contract (UI-SPEC lines 206-218):
//   handleReply: scrolls to compose, sets parentId/username, defers focus past iOS Safari gesture (RESEARCH Pitfall 5)
//   handleClearParent: resets both parentId and replyingToUsername

import { useState, useEffect, useRef } from "react"
import { ReplyCompose } from "@/components/thread/reply-compose"
import { ReplyThread } from "@/components/thread/reply-thread"

interface ThreadSectionProps {
  postId: string
  /** Post is from a past term: replies are read-only (see reply.createReply). */
  closed?: boolean
}

export function ThreadSection({ postId, closed = false }: ThreadSectionProps) {
  const [parentId, setParentId] = useState<string | null>(null)
  const [replyingToUsername, setReplyingToUsername] = useState<string | null>(null)
  const focusTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    return () => {
      if (focusTimerRef.current) clearTimeout(focusTimerRef.current)
    }
  }, [])

  function handleReply(username: string, replyId: string) {
    setParentId(replyId)
    setReplyingToUsername(username)
    // Scroll compose into view first
    document.querySelector("#reply-compose")?.scrollIntoView({ behavior: "smooth" })
    // setTimeout defers focus past iOS Safari's gesture check (RESEARCH Pitfall 5)
    if (focusTimerRef.current) clearTimeout(focusTimerRef.current)
    focusTimerRef.current = setTimeout(() => {
      document.getElementById("reply-compose-textarea")?.focus()
    }, 0)
  }

  function handleClearParent() {
    setParentId(null)
    setReplyingToUsername(null)
  }

  return (
    <>
      {closed ? (
        // The server rejects a reply to a past term's thread outright (reply.createReply),
        // so offering a composer here would only be a trap. Same muted, no-prize
        // treatment a settled leaderboard and a retired lootbox get.
        <p
          role="status"
          className="rounded-md bg-muted/50 px-3 py-2.5 text-sm text-muted-foreground text-pretty ring-1 ring-border"
        >
          <span className="font-medium text-foreground">This term has ended.</span>{" "}
          The thread is closed — you can still read every reply.
        </p>
      ) : (
        <ReplyCompose
          postId={postId}
          parentId={parentId}
          replyingToUsername={replyingToUsername}
          onClearParent={handleClearParent}
        />
      )}
      <h2 className="text-xl font-semibold mt-6 mb-2">Replies</h2>
      <ReplyThread postId={postId} onReply={handleReply} closed={closed} />
    </>
  )
}
