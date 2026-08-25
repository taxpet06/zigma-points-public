"use client"

// TaskThreadSection — client boundary component for /tasks/[id] detail page.
// Mirrors thread-section.tsx exactly, but uses taskId instead of postId.
// Owns lifted parentId/replyingToUsername state shared between TaskReplyThread and ReplyCompose.
//
// Interaction contract (mirrors Phase 5 thread-section.tsx):
//   handleReply: scrolls to compose, sets parentId/username, defers focus past iOS Safari gesture
//   handleClearParent: resets both parentId and replyingToUsername

import { useState, useEffect, useRef } from "react"
import { ReplyCompose } from "@/components/thread/reply-compose"
import { TaskReplyThread } from "@/components/tasks/task-thread"

interface TaskThreadSectionProps {
  taskId: string // mirrors postId in ThreadSection
}

export function TaskThreadSection({ taskId }: TaskThreadSectionProps) {
  const [parentId, setParentId] = useState<string | null>(null)
  const [replyingToUsername, setReplyingToUsername] = useState<string | null>(null)
  const focusTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Cleanup on unmount — copied verbatim from thread-section.tsx
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
      <ReplyCompose
        taskId={taskId}
        parentId={parentId}
        replyingToUsername={replyingToUsername}
        onClearParent={handleClearParent}
      />
      <h2 className="text-xl font-semibold mt-6 mb-2">Replies</h2>
      <TaskReplyThread taskId={taskId} onReply={handleReply} />
    </>
  )
}
