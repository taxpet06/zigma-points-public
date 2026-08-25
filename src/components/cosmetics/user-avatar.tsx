"use client"

import * as React from "react"

import { Avatar, AvatarImage, AvatarFallback } from "@/components/ui/avatar"
import { AvatarRing } from "@/components/cosmetics/avatar-ring"
import { CrownBadge } from "@/components/cosmetics/crown-badge"
import { useCrownHolder } from "@/components/cosmetics/use-crown-holder"
import { cn } from "@/lib/utils"
import { UserCircle } from "lucide-react"

// One avatar to rule them all: image + equipped ring, sized once. Drop this in
// anywhere a user icon appears so the ring renders (and scales) consistently.
// `size` is the pixel diameter — it drives both the avatar box and the ring
// geometry (see cosmetics.css --ring-size).
export function UserAvatar({
  image,
  name,
  ring,
  size = 40,
  className,
  fallback,
  userId,
}: {
  image?: string | null
  name?: string | null
  ring?: string | null
  size?: number
  className?: string
  /** Override the default UserCircle fallback (e.g. initials). */
  fallback?: React.ReactNode
  /**
   * Whose avatar this is. Pass it and the Zigma Maxxer crown appears when this user
   * is the current holder — one shared cached query decides that, so no caller's
   * payload has to carry a crown field. Omit it for a cosmetic preview.
   */
  userId?: string | null
}) {
  const crowned = useCrownHolder(userId)

  return (
    /* The crown is a SIBLING of AvatarRing, not a child. Inside, it would land in
       .avatar-ring__inner (z-index 1, its own stacking context) and the ring's own
       decorations — .logo-orbit at z-index 2 — would pass over it. Out here it
       shares a context with the ring and z-20 puts it above every ring variant. */
    <span className="relative inline-flex shrink-0">
      {crowned && <CrownBadge size={size} />}
      <AvatarRing variant={ring ?? null} size={size}>
        <Avatar
          className={cn("shrink-0", className)}
          style={{ height: size, width: size }}
        >
          <AvatarImage
            src={image ?? undefined}
            alt={name ? `${name}'s profile photo` : "Profile photo"}
          />
          <AvatarFallback>
            {fallback ?? (
              <UserCircle
                className="h-full w-full text-muted-foreground"
                aria-hidden="true"
              />
            )}
          </AvatarFallback>
        </Avatar>
      </AvatarRing>
    </span>
  )
}
