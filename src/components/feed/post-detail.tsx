"use client"

// PostDetail — the post at the top of /post/[id], with voting.
//
// The detail page used to render a read-only PostCard, so tapping into a post from the
// feed took the vote buttons away — the one screen where you've most committed to
// reading the thing. This renders the same PostCard the feed does, with the same
// castVote/retractVote wiring (feed-list.tsx), just against a single post.
//
// The optimistic update mirrors FeedList's: patch the cached post, roll back on error.
// It also invalidates the feed on settle, so going back shows the vote you just cast.

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { useSession } from "next-auth/react"
import { toast } from "sonner"
import { useTRPC } from "@/trpc/client"
import { PostCard } from "@/components/post-card"
import { FeedSkeleton } from "@/components/feed/feed-skeleton"

export function PostDetail({ postId }: { postId: string }) {
  const trpc = useTRPC()
  const qc = useQueryClient()
  const { data: session } = useSession()
  const currentUserId = session?.user?.id
  // Affordance gate only — post.cancelPost re-verifies the role against the DB.
  const isAdmin = session?.user?.role === "ADMIN"

  const filter = trpc.post.getById.queryFilter({ id: postId })
  const postQ = useQuery(trpc.post.getById.queryOptions({ id: postId }))

  /** Shared optimistic patch: apply `patch` to the cached post, keeping a snapshot
   *  to roll back to. Both mutations below differ only in the patch. */
  async function optimistic(patch: (p: NonNullable<typeof postQ.data>) => typeof postQ.data) {
    await qc.cancelQueries(filter)
    const snapshot = qc.getQueriesData(filter)
    qc.setQueriesData(filter, (old: typeof postQ.data) => (old ? patch(old) : old))
    return { snapshot }
  }

  const rollback = (ctx: { snapshot: [readonly unknown[], unknown][] } | undefined) => {
    ctx?.snapshot.forEach(([key, data]) => qc.setQueryData(key, data))
    toast.error("Vote failed — please try again.")
  }

  const settle = () => {
    void qc.invalidateQueries(filter)
    void qc.invalidateQueries(trpc.post.getFeed.queryFilter()) // back-nav shows the new vote
  }

  const castVote = useMutation(
    trpc.post.castVote.mutationOptions({
      onMutate: ({ type }) =>
        optimistic((p) => {
          const prev = p.userVote?.type ?? null
          return {
            ...p,
            agreeCount: p.agreeCount + (type === "AGREE" ? 1 : 0) - (prev === "AGREE" ? 1 : 0),
            disagreeCount:
              p.disagreeCount + (type === "DISAGREE" ? 1 : 0) - (prev === "DISAGREE" ? 1 : 0),
            userVote: { type, userId: currentUserId ?? "" },
          }
        }),
      onError: (_e, _v, ctx) => rollback(ctx),
      onSettled: settle,
    }),
  )

  const retractVote = useMutation(
    trpc.post.retractVote.mutationOptions({
      onMutate: () =>
        optimistic((p) => {
          const prev = p.userVote?.type ?? null
          return {
            ...p,
            agreeCount: p.agreeCount - (prev === "AGREE" ? 1 : 0),
            disagreeCount: p.disagreeCount - (prev === "DISAGREE" ? 1 : 0),
            userVote: null,
          }
        }),
      onError: (_e, _v, ctx) => rollback(ctx),
      onSettled: settle,
    }),
  )

  const cancelPost = useMutation(
    trpc.post.cancelPost.mutationOptions({
      // Same reason as FeedList: the Cancel button is gated on `!post.settled`, so
      // without this patch it survives the round-trip and can be fired twice.
      onMutate: () => optimistic((p) => ({ ...p, settled: true, outcome: "Cancelled" })),
      onError: (_e, _v, ctx) => {
        ctx?.snapshot.forEach(([key, data]) => qc.setQueryData(key, data))
        toast.error("Couldn't cancel this post — please try again.")
      },
      onSuccess: () => toast.success("Post cancelled. No ZP was moved."),
      onSettled: settle,
    }),
  )

  if (postQ.isLoading) return <FeedSkeleton count={1} />
  if (!postQ.data) {
    return (
      <p role="alert" className="py-8 text-center text-sm text-muted-foreground">
        Couldn&rsquo;t load this post.
      </p>
    )
  }

  const post = postQ.data
  return (
    <PostCard
      id={post.id}
      type={post.type as "AWARD" | "DEDUCT" | "REGULAR"}
      title={post.title}
      explanation={post.explanation}
      zpAmount={post.zpAmount}
      mediaUrl={post.mediaUrl ?? undefined}
      images={post.images}
      outcome={post.outcome}
      settled={post.settled}
      votingEndsAt={post.votingEndsAt}
      createdAt={post.createdAt}
      author={post.author}
      targets={post.targets}
      agreeCount={post.agreeCount}
      disagreeCount={post.disagreeCount}
      userVote={post.userVote ? { type: post.userVote.type as "AGREE" | "DISAGREE" } : null}
      currentUserId={currentUserId}
      isPending={castVote.isPending || retractVote.isPending}
      onVote={(type) => castVote.mutate({ postId, type })}
      onRetract={() => retractVote.mutate({ postId })}
      // Role gate only — PostCard decides whether the post is still cancellable.
      onCancel={isAdmin ? () => cancelPost.mutate({ postId }) : undefined}
      isCancelling={cancelPost.isPending}
      // replyCount stays undefined: this card must not link to the page it's already on.
      replyCount={undefined}
    />
  )
}
