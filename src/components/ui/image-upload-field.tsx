"use client"

// ImageUploadField — multi-image picker for the create-post / create-task modals.
//
// Uploads through postMediaUploader (auth-gated, no DB write — see api/uploadthing/core.ts)
// and hands the resulting CDN URLs up via onChange. The parent stores them in form
// state and submits them with the create mutation; nothing is persisted until then.
//
// Mirrors avatar-upload.tsx's useUploadThing + client-side reject pattern.

import { useCallback, useEffect, useRef, useState } from "react"
import { ImagePlus, Loader2, X } from "lucide-react"
import { useUploadThing } from "@/lib/uploadthing"
import { cn } from "@/lib/utils"

// Mirrors postMediaUploader's image maxFileSize in api/uploadthing/core.ts — keep in sync.
const MAX_BYTES = 8 * 1024 * 1024
const MAX_IMAGES = 10

export function ImageUploadField({
  value,
  onChange,
  onUploadingChange,
}: {
  value: string[]
  onChange: (urls: string[]) => void
  onUploadingChange?: (uploading: boolean) => void
}) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [error, setError] = useState<string | null>(null)

  const { startUpload, isUploading } = useUploadThing("postMediaUploader", {
    onUploadError: (e) => setError(e.message || "Upload failed. Try again."),
  })

  // Let the parent block submit while an upload is in flight — otherwise the
  // create mutation fires with only the URLs resolved so far and in-flight
  // images are silently dropped.
  useEffect(() => onUploadingChange?.(isUploading), [isUploading, onUploadingChange])

  const onPick = useCallback(
    async (files: File[]) => {
      if (files.length === 0) return
      const room = MAX_IMAGES - value.length
      if (room <= 0) {
        setError(`Up to ${MAX_IMAGES} images.`)
        return
      }
      const rejected = files.find(
        (f) => !f.type.startsWith("image/") || f.size > MAX_BYTES
      )
      if (rejected) {
        setError(
          !rejected.type.startsWith("image/")
            ? "Only images can be attached."
            : "Each image must be 8MB or smaller."
        )
        return
      }
      setError(null)
      const uploaded = await startUpload(files.slice(0, room))
      if (uploaded) onChange([...value, ...uploaded.map((r) => r.serverData.url)])
    },
    [value, onChange, startUpload]
  )

  const remove = (url: string) => onChange(value.filter((u) => u !== url))
  const atMax = value.length >= MAX_IMAGES

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-2">
        {value.map((url) => (
          <div
            key={url}
            className="relative h-20 w-20 overflow-hidden rounded-md border bg-muted"
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={url} alt="" className="h-full w-full object-cover" />
            <button
              type="button"
              aria-label="Remove image"
              onClick={() => remove(url)}
              className="absolute right-1 top-1 grid h-6 w-6 place-items-center rounded-full bg-black/60 text-white transition-transform duration-150 ease-out active:scale-90 motion-reduce:transition-none"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        ))}

        {!atMax && (
          <button
            type="button"
            onClick={() => inputRef.current?.click()}
            disabled={isUploading}
            className={cn(
              "grid h-20 w-20 place-items-center rounded-md border border-dashed border-input text-muted-foreground",
              "transition-[transform,background-color,border-color] duration-150 ease-out",
              "hover:border-primary/50 hover:bg-accent active:scale-[0.97]",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
              "disabled:cursor-wait motion-reduce:transition-none"
            )}
            aria-label="Add images"
          >
            {isUploading ? (
              <Loader2 className="h-5 w-5 animate-spin" />
            ) : (
              <ImagePlus className="h-5 w-5" />
            )}
          </button>
        )}
      </div>

      <p className="text-xs text-muted-foreground">
        {isUploading
          ? "Uploading…"
          : `Optional. Up to ${MAX_IMAGES} images, 8MB each.`}
      </p>
      {error && (
        <p role="alert" className="text-sm font-medium text-destructive">
          {error}
        </p>
      )}

      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        multiple
        className="sr-only"
        onChange={(e) => {
          void onPick(Array.from(e.target.files ?? []))
          e.target.value = "" // let the same file be re-picked
        }}
      />
    </div>
  )
}
