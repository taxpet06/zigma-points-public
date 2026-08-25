"use client"

// TaskReplyThread — fetches replies for a task, builds the reply tree, and renders it.
// Mirrors reply-thread.tsx but uses task.getTaskReplies and TaskReplyCard.
//
// Data flow: useQuery(getTaskReplies) → buildTree(flat) → TaskReplyCard tree render
//
// Security: T-6-14 — getTaskReplies is protectedProcedure; unauthenticated calls are rejected.

import { useQuery } from "@tanstack/react-query"
import { useTRPC } from "@/trpc/client"
import { TaskReplyCard } from "@/components/tasks/task-reply-card"

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type TaskReplyNode = {
  id: string
  parentId: string | null
  taskId: string | null
  content: string
  mediaUrl: string | null
  createdAt: Date
  author: {
    id: string
    name: string | null
    image: string | null
    username: string | null
    taskCompletions: { status: "PENDING" | "AWARDED"; awardedZp: number | null }[]
  }
  children: TaskReplyNode[]
}

// ---------------------------------------------------------------------------
// buildTree — client-side tree builder from flat oldest-first array
// Copied verbatim from reply-thread.tsx — works for any node with id/parentId/children
// ---------------------------------------------------------------------------

function buildTree(flat: Omit<TaskReplyNode, "children">[]): TaskReplyNode[] {
  const map = new Map<string, TaskReplyNode>()
  const roots: TaskReplyNode[] = []

  // Initialize every node with children: []
  for (const r of flat) map.set(r.id, { ...r, children: [] })

  // Attach each node to its parent's children, or roots if parentId is null/unresolvable
  for (const r of flat) {
    const node = map.get(r.id)!
    if (r.parentId && map.has(r.parentId)) {
      map.get(r.parentId)!.children.push(node)
    } else {
      roots.push(node)
    }
  }

  return roots
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

interface TaskReplyThreadProps {
  taskId: string
  onReply: (authorUsername: string, replyId: string) => void
}

export function TaskReplyThread({ taskId, onReply }: TaskReplyThreadProps) {
  const trpc = useTRPC()
  const { data: repliesData, isLoading } = useQuery(
    trpc.task.getTaskReplies.queryOptions({ taskId })
  )
  const replies = repliesData as Omit<TaskReplyNode, "children">[] | undefined

  if (isLoading) {
    return (
      <div className="space-y-3 mt-4" aria-busy="true">
        {[1, 2, 3].map((i) => (
          <div key={i} className="h-20 rounded-md animate-pulse bg-muted" />
        ))}
      </div>
    )
  }

  if (!repliesData || replies === undefined || replies.length === 0) {
    return (
      <div className="mt-4 flex flex-col items-center py-12 text-center animate-card-rise">
        <p className="text-sm font-medium">No replies yet.</p>
        <p className="mt-1 text-sm text-muted-foreground">Be the first to share your thoughts.</p>
      </div>
    )
  }

  const tree = buildTree(replies)

  return (
    <section aria-label="Replies" className="mt-4 space-y-2">
      {tree.map((reply) => (
        <TaskReplyCard
          key={reply.id}
          reply={reply}
          taskId={taskId}
          depth={0}
          onReply={onReply}
        />
      ))}
    </section>
  )
}
