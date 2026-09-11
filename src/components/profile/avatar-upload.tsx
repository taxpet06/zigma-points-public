"use client"

// AvatarUpload — the profile photo editor on /profile/edit.
//
// The avatar itself is the upload target: click it to pick a file. A separate
// "change photo" button would compete with the image it edits, and the old
// version of this component showed no avatar at all.
//
// Security: upload auth is enforced server-side in avatarUploader.middleware()
// (T-02-10), which also persists the URL. The client only invalidates getMe so
// the nav and form avatars pick up the new image. The size/type check below is
// UX only — it fails fast before a doomed round-trip; the server cap is the
// real boundary.

import { useCallback, useEffect, useRef, useState } from "react"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import { Camera, LoaderCircle } from "lucide-react"
import { useUploadThing } from "@/lib/uploadthing"
import { useTRPC } from "@/trpc/client"
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import { cn } from "@/lib/utils"

// Mirrors avatarUploader's maxFileSize in app/api/uploadthing/core.ts — keep in sync.
const MAX_BYTES = 4 * 1024 * 1024

/** Exported for unit test — the only branching logic worth pinning down. */
export function rejectFile(file: { size: number; type: string }): string | null {
  if (!file.type.startsWith("image/")) return "That file isn't an image."
  if (file.size > MAX_BYTES) return "That image is over 4MB. Pick a smaller one."
  return null
}

export function AvatarUpload() {
  const trpc = useTRPC()
  const queryClient = useQueryClient()
  const inputRef = useRef<HTMLInputElement>(null)
  const [preview, setPreview] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const { data: me } = useQuery(trpc.user.getMe.queryOptions())

  const { startUpload, isUploading } = useUploadThing("avatarUploader", {
    onClientUploadComplete: async () => {
      setError(null)
      // Await the refetch before dropping the preview: clearing it early would flash
      // the old avatar back while getMe is still in flight.
      await queryClient.invalidateQueries(trpc.user.getMe.queryFilter())
      setPreview(null)
    },
    onUploadError: (e) => {
      setPreview(null)
      setError(e.message || "Upload failed. Try again.")
    },
  })

  // Object URLs leak until revoked; drop each one when it's replaced or on unmount.
  useEffect(() => {
    if (!preview) return
    return () => URL.revokeObjectURL(preview)
  }, [preview])

  const onPick = useCallback(
    (file: File | undefined) => {
      if (!file) return
      const rejection = rejectFile(file)
      if (rejection) {
        setError(rejection)
        return
      }
      setError(null)
      setPreview(URL.createObjectURL(file))
      void startUpload([file])
    },
    [startUpload]
  )

  const shown = preview ?? me?.image ?? undefined
  const initials = ((me?.name || "?")[0] ?? "?").toUpperCase()

  return (
    <div className="flex items-center gap-4">
      <button
        type="button"
        onClick={() => inputRef.current?.click()}
        disabled={isUploading}
        aria-label="Change profile photo"
        className={cn(
          "group relative rounded-full outline-none",
          "transition-transform duration-150 ease-out active:scale-[0.97]",
          "focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
          "focus-visible:ring-offset-background disabled:cursor-wait",
          "motion-reduce:transition-none motion-reduce:active:scale-100"
        )}
      >
        {/* 80px — comfortably over the 44px touch minimum (PRODUCT.md). */}
        <Avatar className="h-20 w-20 border border-border">
          <AvatarImage src={shown} alt="" />
          <AvatarFallback className="text-2xl font-semibold">{initials}</AvatarFallback>
        </Avatar>

        {/* Scrim: hover/focus on pointer devices, and always while uploading. */}
        <span
          aria-hidden
          className={cn(
            "pointer-events-none absolute inset-0 rounded-full bg-foreground/40",
            "opacity-0 transition-opacity duration-150 ease-out",
            // Tailwind v4 already wraps `hover` in @media (hover: hover), so this
            // won't stick on touch after a tap.
            "group-hover:opacity-100 group-focus-visible:opacity-100",
            "motion-reduce:transition-none",
            isUploading && "opacity-100"
          )}
        />

        {isUploading && (
          <LoaderCircle
            aria-hidden
            className="absolute left-1/2 top-1/2 h-6 w-6 -translate-x-1/2 -translate-y-1/2 animate-spin text-background"
          />
        )}

        {/* Always visible — a hover-only affordance would be invisible on touch,
            which is the primary context for this product. */}
        <span
          aria-hidden
          className={cn(
            "absolute -bottom-0.5 -right-0.5 grid h-7 w-7 place-items-center rounded-full",
            "border-2 border-background bg-primary text-primary-foreground",
            "transition-opacity duration-150 ease-out motion-reduce:transition-none",
            isUploading && "opacity-0"
          )}
        >
          <Camera className="h-3.5 w-3.5" />
        </span>
      </button>

      <div className="min-w-0">
        <p className="text-sm font-medium">Profile photo</p>
        <p className="text-sm text-muted-foreground">
          {isUploading ? "Uploading…" : "JPG, PNG or GIF. Up to 4MB."}
        </p>
        {error && (
          <p role="alert" className="mt-1 text-sm font-medium text-destructive">
            {error}
          </p>
        )}
      </div>

      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        className="sr-only"
        onChange={(e) => {
          onPick(e.target.files?.[0])
          // Reset so picking the same file twice still fires change.
          e.target.value = ""
        }}
      />
    </div>
  )
}
