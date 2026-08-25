// /post/[id] — Post detail page (server component).
//
// Security:
//   T-05-06 — the post body is fetched by post.getById (protectedProcedure), whose
//             explicit select never returns password or email and strips the raw vote list.
//   T-05-07 — unknown/invalid post id → notFound(); Prisma parameterizes where:{id} (no injection).
//
// Next.js 15: params is a Promise — must await (PATTERNS.md async params pattern).

import { notFound } from "next/navigation"
import { db } from "@/lib/db"
import { PostDetail } from "@/components/feed/post-detail"
import { ThreadSection } from "@/components/thread/thread-section"

export default async function PostDetailPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params // REQUIRED in Next.js 15 — params is a Promise

  // T-05-07: unknown post id -> notFound(). Existence check only; PostDetail fetches
  // the post itself via post.getById so it can render live vote counts and vote.
  const exists = await db.post.findUnique({ where: { id }, select: { id: true } })
  if (!exists) notFound()

  return (
    <main className="max-w-2xl mx-auto px-4 py-6">
      {/* Original post — votable here, same as in the feed (client boundary) */}
      <PostDetail postId={id} />

      {/* Interactive thread: compose + replies (client boundary) */}
      <div className="mt-4">
        <ThreadSection postId={id} />
      </div>
    </main>
  )
}
