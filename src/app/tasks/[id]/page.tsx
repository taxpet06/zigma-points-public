// /tasks/[id] — Task detail page (server component).
// Mirrors /post/[id]/page.tsx — TaskCard at top + TaskThreadSection for replies.
//
// Security:
//   T-6-14 — requireSession() enforces authentication before any DB access.
//   T-6-15 — explicit select excludes password/email; admin limited to id/name/image.
//
// Next.js 15: params is a Promise — must await (PATTERNS.md async params pattern).
//
// TASK-02: /tasks/[id] shows task + threaded replies; users can reply and nest (D-09).

import { notFound } from "next/navigation"
import { db } from "@/lib/db"
import { requireSession } from "@/lib/auth-helpers"
import { TaskCard } from "@/components/tasks/task-card"
import { TaskThreadSection } from "@/components/tasks/task-thread-section"
import { BetPanel } from "@/components/tasks/bet-panel"

export default async function TaskDetailPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params // REQUIRED in Next.js 15 — params is a Promise

  const session = await requireSession() // T-6-14: authenticated users only
  const isAdmin = session.user.role === "ADMIN"

  // T-6-15: explicit select — never select password or email
  const task = await db.task.findUnique({
    where: { id },
    select: {
      id: true,
      title: true,
      description: true,
      zpReward: true,
      kind: true,
      minBet: true,
      betsCloseAt: true,
      winningChoice: true,
      betSettledAt: true,
      mediaUrl: true,
      images: true,
      createdAt: true,
      admin: { select: { id: true, name: true, image: true } }, // no password
    },
  })

  // Unknown/invalid task id → 404
  if (!task) notFound()

  return (
    <main className="max-w-2xl mx-auto px-4 py-6">
      {/* Task card (read-only — no vote buttons on tasks) */}
      <TaskCard
        id={task.id}
        title={task.title}
        description={task.description}
        zpReward={task.zpReward}
        kind={task.kind}
        minBet={task.minBet}
        betsCloseAt={task.betsCloseAt}
        winningChoice={task.winningChoice}
        betSettled={task.betSettledAt !== null}
        mediaUrl={task.mediaUrl}
        images={task.images}
        createdAt={task.createdAt}
        admin={task.admin}
        replyCount={undefined}
        canEdit={isAdmin}
      />

      {/* Betting pool UI — place bet / live odds / admin settle (BET tasks only) */}
      {task.kind === "BET" && (
        <div className="mt-4">
          <BetPanel taskId={task.id} isAdmin={isAdmin} />
        </div>
      )}

      {/* Interactive thread: compose + task replies (client boundary) — trash talk welcome */}
      <div className="mt-4">
        <TaskThreadSection taskId={task.id} />
      </div>
    </main>
  )
}
