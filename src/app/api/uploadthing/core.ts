// Uploadthing FileRouter — avatar upload route with NextAuth v5 auth gate.
//
// Security (T-02-01 — Spoofing):
//   middleware() calls auth() and throws UploadThingError("Unauthorized") if no session.
//   Only authenticated users receive a presigned upload URL.
//
// Pattern: docs.uploadthing.com/getting-started/appdir

import { createUploadthing, type FileRouter } from "uploadthing/next"
import { UploadThingError } from "uploadthing/server"
import { auth } from "@/auth"
import { db } from "@/lib/db"

const f = createUploadthing()

export const ourFileRouter = {
  avatarUploader: f({
    image: { maxFileSize: "4MB", maxFileCount: 1 },
  })
    .middleware(async () => {
      // auth() without args reads session cookies in Route Handler context (NextAuth v5 universal accessor).
      // Throws UploadThingError if no session — rejects unauthenticated upload requests (T-02-01).
      const session = await auth()
      if (!session?.user?.id) throw new UploadThingError("Unauthorized")
      return { userId: session.user.id }
    })
    .onUploadComplete(async ({ metadata, file }) => {
      // Persist the CDN URL to the user record server-side.
      // The client can then invalidate the getMe query to refresh the avatar.
      await db.user.update({
        where: { id: metadata.userId },
        data: { image: file.ufsUrl },
      })
      return { uploadedBy: metadata.userId, url: file.ufsUrl }
    }),

  //
  // Post media uploader — image and video attachments for AWARD/DEDUCT posts.
  //
  // Security (T-03-07 — Spoofing):
  //   middleware() calls auth() and throws UploadThingError("Unauthorized") if no session.
  //   Only authenticated users receive a presigned upload URL.
  //
  // Important: onUploadComplete does NOT write to the database.
  //   The post does not exist yet when media is uploaded — the URL is returned to the client,
  //   stored in form state, and submitted together with the createPost mutation input.
  //   Writing to DB here would create orphaned records with no post (Risk 4 in RESEARCH.md).
  //
  // File constraints:
  //   image: 8MB max — covers high-quality photos + GIFs (GIF is a valid image MIME type)
  //   video: 64MB max — short clips; roughly 1-2 min at typical mobile quality
  //   maxFileCount: up to 10 images per post/task (carousel); one video
  //
  postMediaUploader: f({
    image: { maxFileSize: "8MB", maxFileCount: 10 },
    video: { maxFileSize: "64MB", maxFileCount: 1 },
  })
    .middleware(async () => {
      const session = await auth()
      if (!session?.user?.id) throw new UploadThingError("Unauthorized")
      return { userId: session.user.id }
    })
    .onUploadComplete(async ({ file }) => {
      // DO NOT save to DB here — the post doesn't exist yet.
      // Return the URL to the client; client stores in form state and submits with createPost.
      return { url: file.url }
    }),
} satisfies FileRouter

export type OurFileRouter = typeof ourFileRouter
