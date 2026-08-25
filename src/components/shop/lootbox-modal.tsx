"use client"

// LootboxModal — the Phase-18 shell replacing shop-grid's Phase-17 confirm+toast
// seam. Composes the shadcn Dialog primitives DIRECTLY (not GameDialog): GameDialog's
// onOpenChange always closes, but the reveal phase (18-04) must intercept Esc/backdrop
// and skip to the result instead of closing early. Owns the money path — openBox +
// equip both moved here from shop-grid — so shop-grid keeps only "which box is open."
//
// State machine: browsing -> opening -> arming -> bursting -> revealing -> settled.
// openBox's onSuccess stores `res` (resolve-then-animate — the outcome is already
// known) and hands it to `playReveal`, a data-phase timeline over the `.lootbox-stage`
// root that cosmetics.css's keyframes (18-02) react to; ChestReveal (18-04 Task 1)
// mounts the chest/confetti layers this timeline steps through. A tap on the stage,
// or Esc/backdrop during the sequence, aborts the pending timeline and jumps straight
// to 'settled' (result already known). The reveal plays for everyone regardless
// of OS reduced-motion (by request) — globals.css exempts `.lootbox-stage`.

import { useEffect, useRef, useState } from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { toast } from "sonner"
import { useTRPC } from "@/trpc/client"
import { cn } from "@/lib/utils"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Avatar, AvatarFallback } from "@/components/ui/avatar"
import { UserCircle } from "lucide-react"
import { CardBackground } from "@/components/cosmetics/card-background"
import { AvatarRing } from "@/components/cosmetics/avatar-ring"
import { COSMETICS, LOOTBOXES, RARITY_META, lootboxOdds, type Rarity } from "@/lib/cosmetics"
import { ChestReveal, type ChestRevealHandle, type Phase } from "@/components/shop/chest-reveal"
import { ChestSvg } from "@/components/shop/chest-svg"

type Lootbox = (typeof LOOTBOXES)[string]

// Per-rarity anticipation length (UI-SPEC §4 table) — the wait before 'bursting'.
const ANTICIPATION_MS: Record<Rarity, number> = { COMMON: 300, RARE: 450, LEGENDARY: 650 }

// Cancelable wait: rejects immediately if already aborted, or the moment `signal`
// aborts mid-wait — lets the skip handler jump to 'settled' in <200ms regardless
// of which beat the timeline is parked in (research §5 "repeat opens feel instant").
function wait(ms: number, signal: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    if (signal.aborted) {
      reject(new DOMException("skipped", "AbortError"))
      return
    }
    const id = window.setTimeout(resolve, ms)
    signal.addEventListener(
      "abort",
      () => {
        window.clearTimeout(id)
        reject(new DOMException("skipped", "AbortError"))
      },
      { once: true },
    )
  })
}

// Public wrapper: only tracks WHICH box was last opened (never reset to null, so
// the dialog keeps rendering its content through the Radix close-fade) and hands
// that off to a keyed inner component. The key remount is what gives every fresh
// open a clean phase/mutation slate — simpler and lint-clean vs. resetting state
// imperatively in an effect.
export function LootboxModal({
  boxId,
  onClose,
  onSuccess,
  onReveal,
}: {
  boxId: string | null
  onClose: () => void
  onSuccess: () => void
  /** Reserved hook for a future sound sting (no audio this phase) — fired at
   * the bursting transition alongside the confetti burst. */
  onReveal?: (rarity: Rarity) => void
}) {
  const [renderedBoxId, setRenderedBoxId] = useState(boxId)
  const [prevBoxId, setPrevBoxId] = useState(boxId)
  const [openNonce, setOpenNonce] = useState(0)
  // Bump a nonce on every open edge (null -> a box) so the keyed dialog remounts
  // FRESH each time it opens — even the same box in a row lands back on 'browsing'
  // instead of the previous reveal's result. renderedBoxId still caches the box id
  // through the Radix close-fade (never reset to null), so the nonce, not the id,
  // is what forces the remount on a same-box reopen.
  if (boxId !== prevBoxId) {
    setPrevBoxId(boxId)
    if (boxId !== null) setOpenNonce((n) => n + 1)
  }
  if (boxId !== null && boxId !== renderedBoxId) {
    setRenderedBoxId(boxId)
  }
  const lootbox = renderedBoxId ? LOOTBOXES[renderedBoxId] : null
  if (!lootbox) return null

  return (
    <LootboxDialog
      key={`${renderedBoxId}-${openNonce}`}
      open={boxId !== null}
      lootbox={lootbox}
      onClose={onClose}
      onSuccess={onSuccess}
      onReveal={onReveal}
    />
  )
}

function LootboxDialog({
  open,
  lootbox,
  onClose,
  onSuccess,
  onReveal,
}: {
  open: boolean
  lootbox: Lootbox
  onClose: () => void
  onSuccess: () => void
  onReveal?: (rarity: Rarity) => void
}) {
  const trpc = useTRPC()
  const qc = useQueryClient()
  const [phase, setPhase] = useState<Phase>("browsing")
  const chestRevealRef = useRef<ChestRevealHandle>(null)
  const revealAbortRef = useRef<AbortController | null>(null)

  async function playReveal(result: { rarity: Rarity }, signal: AbortSignal) {
    // The reveal plays for EVERYONE, regardless of OS reduced-motion (by request) —
    // globals.css exempts `.lootbox-stage` from the blanket reduce rule and confetti
    // fires unconditionally, matching the casino games' always-animate convention.
    try {
      setPhase("arming")
      await wait(ANTICIPATION_MS[result.rarity], signal)
      setPhase("bursting")
      onReveal?.(result.rarity)
      chestRevealRef.current?.fireBurst()
      await wait(130, signal)
      setPhase("revealing")
      await wait(400, signal)
      setPhase("settled")
    } catch {
      // Aborted (tap-to-skip or unmount) — the skip handler already set
      // phase to 'settled' itself; nothing left to do here.
    }
  }

  function skipReveal() {
    if (phase === "arming" || phase === "bursting" || phase === "revealing") {
      revealAbortRef.current?.abort()
      setPhase("settled")
    }
  }

  const openBox = useMutation(
    trpc.shop.openBox.mutationOptions({
      onMutate: () => setPhase("opening"),
      // Reading/writing revealAbortRef here would trip react-hooks/refs (a ref
      // read inside a callback handed to the non-hook `mutationOptions` call
      // can't be proven to run outside render) — the reveal timeline is kicked
      // off by the `res` effect below instead, which is a safe ref-read site.
      onSuccess: () => onSuccess(),
      onError: (e) => {
        toast.error(e.message || "Couldn't open that lootbox.")
        setPhase("browsing")
      },
    }),
  )

  const equip = useMutation(
    trpc.shop.equip.mutationOptions({
      onError: (e) => toast.error(e.message || "Couldn't update equip state."),
      onSuccess: () => void qc.invalidateQueries(trpc.shop.getShop.queryFilter()),
    }),
  )

  // Already fetched (and cached app-wide) by the shop grid — no second endpoint for
  // the strip's per-item circulation count (UI-SPEC §7).
  const { data: shop } = useQuery(trpc.shop.getShop.queryOptions())
  const circulationBySlug = new Map(shop?.map((c) => [c.slug, c.circulation]) ?? [])

  const res = openBox.data ?? null
  const items = COSMETICS.filter(
    (c) => c.collection === lootbox.collection && c.kind === lootbox.kind,
  )

  // resolve-then-animate (never gate the result on the animation): `res` is
  // already known the instant this effect sees it — the timeline below is
  // pure theater over that outcome. Runs on every fresh `res` (including a
  // repeat "Open again"), aborted+restarted if it changes, and cleaned up
  // on unmount so no stray setTimeout ever fires setPhase after teardown.
  useEffect(() => {
    if (!res) return
    const controller = new AbortController()
    revealAbortRef.current = controller
    // Deferred via a 0ms timer (not called synchronously in the effect body)
    // so the phase transitions inside playReveal are setState-in-a-callback,
    // not setState-during-the-effect — the pattern react-hooks/set-state-in-effect
    // asks for ("calling setState in a callback function when external state changes").
    const id = window.setTimeout(() => {
      if (!controller.signal.aborted) void playReveal(res, controller.signal)
    }, 0)
    return () => {
      window.clearTimeout(id)
      controller.abort()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- keyed on res only; playReveal/onReveal are stable for the lifetime of one dialog instance.
  }, [res])

  function handleOpenAgain() {
    // Spend + open a new box immediately (no trip back to the carousel). onMutate
    // flips to 'opening'; when the new result lands, the res effect plays the reveal.
    equip.reset()
    openBox.mutate({ boxId: lootbox.id })
  }

  function handleOpenChange(next: boolean) {
    if (next) return // open is controlled by the parent; Dialog only ever reports closing
    if (phase === "browsing" || phase === "settled") {
      onClose()
      return
    }
    // opening/arming/bursting/revealing: never let Esc/backdrop-click close
    // before a result exists; once one does, skip straight to it instead
    // (result is never lost to a stray tap).
    skipReveal()
  }

  const isBrowsing = phase === "browsing"
  const isOpening = phase === "opening"
  const isRevealing =
    phase === "arming" || phase === "bursting" || phase === "revealing" || phase === "settled"

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{lootbox.name}</DialogTitle>
          <DialogDescription className="sr-only">{lootbox.name}</DialogDescription>
        </DialogHeader>

        <div
          className="lootbox-stage flex min-w-0 flex-col gap-4"
          data-phase={phase}
          data-rarity={res ? res.rarity.toLowerCase() : "common"}
          onClick={skipReveal}
        >
          {isBrowsing && (
            <>
              {/* py-2 is not decoration: `overflow-x: auto` forces overflow-y to compute to
                  auto as well, so this element clips vertically too — without the padding the
                  rarity glow and the tile's 1px ring get cut off at the top edge. Same reason
                  the -mx-1 px-1 pair is here for the horizontal axis.
                  ponytail: 8px clears the resting ring and Common's static glow outright, and
                  reads fine for the 6 Rare / 2 Legendary items, whose pulses only reach their
                  ~20px/~28px peaks for a fraction of the cycle. Bump it if that ever shows. */}
              <div
                className="flex gap-3 overflow-x-auto snap-x snap-mandatory -mx-1 px-1 py-2"
                role="group"
                aria-label="Items in this box"
                tabIndex={0}
              >
                {items.map((c) => (
                  <div
                    key={c.slug}
                    className="flex w-20 shrink-0 snap-start flex-col items-center gap-1 text-center"
                  >
                    {c.kind === "BACKGROUND" ? (
                      <div
                        className={cn(
                          "relative h-16 w-16 overflow-hidden rounded-md",
                          RARITY_META[c.rarity].glowClass,
                        )}
                      >
                        <CardBackground variant={c.slug} />
                      </div>
                    ) : c.kind === "RING" ? (
                      <div className={cn("rounded-full", RARITY_META[c.rarity].glowClass)}>
                        <AvatarRing variant={c.slug} size={44}>
                          <Avatar className="h-11 w-11">
                            <AvatarFallback>
                              <UserCircle className="h-5 w-5" aria-hidden="true" />
                            </AvatarFallback>
                          </Avatar>
                        </AvatarRing>
                      </div>
                    ) : (
                      <div
                        className={cn(
                          "flex h-16 w-16 items-center justify-center overflow-hidden rounded-md border bg-muted p-1 text-center",
                          RARITY_META[c.rarity].glowClass,
                        )}
                      >
                        <span
                          className="font-semibold leading-tight"
                          // A 64px tile leaves ~56px of text width, which a long single
                          // word ("Permatarded") overflows and overflow-hidden then clips.
                          // hyphens:auto breaks it with a real hyphen (<html lang="en">
                          // is set, which it requires); overflowWrap is the fallback for
                          // words the hyphenation dictionary won't split.
                          style={{
                            color: RARITY_META[c.rarity].hex,
                            fontSize: 11,
                            hyphens: "auto",
                            overflowWrap: "anywhere",
                          }}
                        >
                          {c.name}
                        </span>
                      </div>
                    )}
                    {/* Was `truncate`, which ellipsis-clipped any name wider than the
                        80px column ("Chrysanthemum Ring", most titles). Wrapping with
                        hyphenation shows the whole name; the strip stretches columns to
                        the tallest so nothing goes ragged. */}
                    <span className="w-full hyphens-auto break-words text-[11px] text-muted-foreground">
                      {c.name}
                    </span>
                    <span
                      className="text-[10px] font-semibold uppercase tracking-wide"
                      style={{ color: RARITY_META[c.rarity].hex }}
                    >
                      {RARITY_META[c.rarity].label}
                    </span>
                    <span className="text-[10px] tabular-nums text-muted-foreground">
                      {circulationBySlug.get(c.slug) ?? 0} in circulation
                    </span>
                  </div>
                ))}
              </div>

              <div className="space-y-1.5 text-sm text-muted-foreground">
                <p>
                  <span className="font-semibold text-foreground">{lootbox.name}</span>{" "}
                  <span className="font-mono tabular-nums">— {lootbox.price} ZP</span>
                </p>
                <p>
                  Contains one of {items.length} 26X Collection{" "}
                  {lootbox.kind === "BACKGROUND"
                    ? "backgrounds"
                    : lootbox.kind === "RING"
                      ? "rings"
                      : "titles"}
                  .
                </p>
                <p className="flex flex-wrap items-center gap-x-3 gap-y-0.5">
                  <span className="text-muted-foreground">Odds:</span>
                  {lootboxOdds(lootbox.id).map((o) => (
                    <span
                      key={o.rarity}
                      className="font-semibold"
                      style={{ color: RARITY_META[o.rarity].hex }}
                    >
                      {RARITY_META[o.rarity].label} {Math.round(o.pct)}%
                    </span>
                  ))}
                </p>
                <p>Every copy is numbered. Duplicates refund half your ZP.</p>
              </div>

              <div className="flex flex-col gap-2">
                <Button className="w-full" onClick={() => openBox.mutate({ boxId: lootbox.id })}>
                  Open for {lootbox.price} ZP
                </Button>
                <Button variant="outline" className="w-full" onClick={onClose}>
                  Close
                </Button>
              </div>
            </>
          )}

          {isOpening && (
            <div className="flex flex-col items-center justify-center gap-3 py-12">
              <ChestSvg size={72} />
              <p className="animate-pulse text-sm font-medium text-muted-foreground">Opening…</p>
            </div>
          )}

          {isRevealing && res && (
            <div className="flex flex-col items-center gap-3 text-center">
              <ChestReveal
                ref={chestRevealRef}
                rarity={res.rarity}
                phase={phase}
                prizeSlot={
                  res.kind === "BACKGROUND" ? (
                    <div className="relative h-full w-full overflow-hidden rounded-lg">
                      <CardBackground variant={res.slug} />
                    </div>
                  ) : res.kind === "RING" ? (
                    <AvatarRing variant={res.slug} size={92}>
                      <Avatar className="h-[92px] w-[92px]">
                        <AvatarFallback>
                          <UserCircle className="h-11 w-11" aria-hidden="true" />
                        </AvatarFallback>
                      </Avatar>
                    </AvatarRing>
                  ) : (
                    <div
                      className={cn(
                        "flex h-full w-full items-center justify-center overflow-hidden rounded-md border bg-muted p-1 text-center",
                        RARITY_META[res.rarity].glowClass,
                      )}
                    >
                      <span
                        className="font-semibold leading-tight"
                        // 92px here vs the strip's 64px, so the type stays at 12 — but the
                        // same wrapping guards apply so a long name never clips.
                        style={{
                          color: RARITY_META[res.rarity].hex,
                          fontSize: 12,
                          hyphens: "auto",
                          overflowWrap: "anywhere",
                        }}
                      >
                        {res.name}
                      </span>
                    </div>
                  )
                }
              />

              {phase === "settled" && (
                <>
                  <div className="flex flex-col items-center gap-1.5">
                    <p className="text-base font-semibold">{res.name}</p>
                    <p
                      className={cn(
                        "text-sm font-semibold",
                        res.isNew ? "text-[#059669]" : "text-muted-foreground",
                      )}
                    >
                      {res.isNew ? "New!" : `Duplicate — +${res.refunded} ZP back`}
                    </p>
                    <p className="text-xs tabular-nums text-muted-foreground">
                      #{res.mintNumber} / {res.circulation} in circulation
                    </p>
                    <span
                      className="inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium"
                      style={{ color: RARITY_META[res.rarity].hex, borderColor: RARITY_META[res.rarity].hex }}
                    >
                      {RARITY_META[res.rarity].label}
                    </span>
                  </div>

                  <div className="flex w-full flex-col gap-2">
                    <Button
                      className="w-full"
                      disabled={equip.isPending || equip.isSuccess}
                      onClick={() => equip.mutate({ slug: res.slug, kind: res.kind })}
                    >
                      {equip.isSuccess ? "Equipped" : equip.isPending ? "Equipping…" : "Equip"}
                    </Button>
                    <Button variant="outline" className="w-full" onClick={handleOpenAgain}>
                      Open again · {lootbox.price} ZP
                    </Button>
                    <Button variant="ghost" className="w-full" onClick={onClose}>
                      Close
                    </Button>
                  </div>
                </>
              )}
            </div>
          )}
        </div>

        {/* Screen readers never perceive the animation — this is the real result
            channel, populated the instant res is known. */}
        <div aria-live="polite" className="sr-only">
          {res
            ? `You won ${res.name} — ${RARITY_META[res.rarity].label}. Copy ${
                res.mintNumber
              } of ${res.circulation} in circulation. ${
                res.isNew ? "New!" : `Duplicate — ${res.refunded} ZP refunded.`
              }`
            : ""}
        </div>
      </DialogContent>
    </Dialog>
  )
}
