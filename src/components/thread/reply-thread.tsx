"use client"

// ReplyThread — fetches replies for a post, builds the reply tree, and renders it.
// Shares onReply callback with ReplyCompose via the parent ThreadSection component.
//
// Data flow: useQuery(getReplies) → buildTree(flat) → ReplyCard tree render

import { useQuery } from "@tanstack/react-query"
import { useTRPC } from "@/trpc/client"
import { ReplyCard } from "@/components/thread/reply-card"

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type ReplyNode = {
  id: string
  parentId: string | null
  content: string
  mediaUrl: string | null
  createdAt: Date
  author: {
    id: string
    name: string | null
    image: string | null
    username: string | null
  }
  children: ReplyNode[]
}

// ---------------------------------------------------------------------------
// buildTree — client-side tree builder from flat oldest-first array
// ---------------------------------------------------------------------------

function buildTree(flat: Omit<ReplyNode, "children">[]): ReplyNode[] {
  const map = new Map<string, ReplyNode>()
  const roots: ReplyNode[] = []

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

interface ReplyThreadProps {
  postId: string
  onReply: (authorUsername: string, replyId: string) => void
}

export function ReplyThread({ postId, onReply }: ReplyThreadProps) {
  const trpc = useTRPC()
  const { data: repliesData, isLoading } = useQuery(
    trpc.reply.getReplies.queryOptions({ postId })
  )
  const replies = repliesData as Omit<ReplyNode, "children">[] | undefined

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
        <ReplyCard
          key={reply.id}
          reply={reply}
          depth={0}
          onReply={onReply}
        />
      ))}
    </section>
  )
}
