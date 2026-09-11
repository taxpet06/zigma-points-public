import { CreatePostModal } from "@/components/feed/create-post-modal"

export function FeedEmptyState() {
  return (
    <div className="py-16 text-center animate-card-rise">
      <h2 className="text-xl font-semibold mb-2">No posts yet.</h2>
      <p className="text-sm text-muted-foreground mb-6">
        Be the first to award or deduct points.
      </p>
      <CreatePostModal />
    </div>
  )
}
