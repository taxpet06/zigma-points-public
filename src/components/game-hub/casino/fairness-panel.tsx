"use client"

// FairnessPanel — the provably-fair collapsed row every casino game shares
// (10-UI-SPEC.md § 4). Native <details>, not a shadcn disclosure primitive:
// accessible, tap-native, zero JS, zero bytes (MOBL-03). "Provably fair" is
// one of exactly two places this phrase appears in the whole casino — a
// trust mark that shouts is noise for the 95% who never open it.
//
// Hosts the Verifier (verifier.tsx) inside, below the rotate block.

import * as React from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { Check, ChevronDown, Copy, ShieldCheck } from "lucide-react"
import { useTRPC } from "@/trpc/client"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { newServerSeed } from "@/lib/casino/fairness"
import { CASINO_GAMES } from "@/lib/casino/games"
import { cn } from "@/lib/utils"
import { Verifier } from "./verifier"

const panelShell = "rounded-lg bg-muted/30 px-3 py-2.5"

const CLIENT_SEED_COLON_ERROR = "Client seeds can't contain a colon (:)."

// Mirrors the server's zod rule (casino.ts clientSeedSchema) so a predictable
// rejection is caught before a round trip — the server regex stays the
// authority; this is client-side feedback only.
function validateClientSeed(value: string): string | null {
  if (value.includes(":")) return CLIENT_SEED_COLON_ERROR
  if (value.length < 1 || value.length > 64) return "Client seed must be 1–64 characters."
  return null
}

function truncateHash(hash: string): string {
  return `${hash.slice(0, 8)}…${hash.slice(-6)}`
}

/** Icon-button copy affordance shared by the hash row and the revealed seed.
 *  Swaps to a checkmark for 1200ms and announces via aria-live — never a
 *  hover-only tooltip (MOBL-03). */
function CopyButton({ text, label }: { text: string; label: string }) {
  const [copied, setCopied] = React.useState(false)
  const [announcement, setAnnouncement] = React.useState("")
  const timeoutRef = React.useRef<ReturnType<typeof setTimeout> | null>(null)

  React.useEffect(() => () => {
    if (timeoutRef.current) clearTimeout(timeoutRef.current)
  }, [])

  async function handleCopy() {
    await navigator.clipboard.writeText(text)
    setCopied(true)
    setAnnouncement(`${label} copied`)
    if (timeoutRef.current) clearTimeout(timeoutRef.current)
    timeoutRef.current = setTimeout(() => setCopied(false), 1200)
  }

  return (
    <>
      <Button
        type="button"
        variant="outline"
        size="icon"
        className="h-11 w-11 shrink-0"
        aria-label={`Copy ${label.toLowerCase()}`}
        onClick={handleCopy}
      >
        {copied ? <Check className="h-4 w-4" aria-hidden="true" /> : <Copy className="h-4 w-4" aria-hidden="true" />}
      </Button>
      <span aria-live="polite" className="sr-only">
        {announcement}
      </span>
    </>
  )
}

type CasinoGameSlug = (typeof CASINO_GAMES)[number]["slug"]

export function FairnessPanel({
  historyPrefill,
}: {
  /** Set by casino-fairness-dialog.tsx when a bet-history row is tapped (10-09) — the
   *  primary path into the Verifier below. Takes priority over the rotation-reveal
   *  example prefill while present. `serverSeed`/`recordedHash` are both null for a
   *  row whose seed pair hasn't rotated yet; the Verifier renders its own honest
   *  "cannot verify yet" state for that rather than this panel hiding the row's tap.
   *  `config`/`recordedMultiplier` (11-07) are the settled bet's own data, passed
   *  straight through to the Verifier's per-game derive branch. */
  historyPrefill?: {
    serverSeed: string | null
    clientSeed: string
    nonce: number
    game: CasinoGameSlug
    recordedHash: string | null
    config: unknown
    recordedMultiplier: number | null
  } | null
} = {}) {
  const trpc = useTRPC()
  const qc = useQueryClient()
  const seedQ = useQuery(trpc.casino.getSeed.queryOptions())
  const setClientSeed = useMutation(trpc.casino.setClientSeed.mutationOptions())
  const rotateSeed = useMutation(trpc.casino.rotateSeed.mutationOptions())

  const [hashExpanded, setHashExpanded] = React.useState(false)

  const [clientSeedDraft, setClientSeedDraft] = React.useState<string | null>(null)
  const [clientSeedError, setClientSeedError] = React.useState<string | null>(null)

  const [rotating, setRotating] = React.useState(false)
  const [rotateClientSeed, setRotateClientSeed] = React.useState("")
  const [rotateError, setRotateError] = React.useState<string | null>(null)

  // The retired pair's revealed seed + the hash it must hash to (captured
  // BEFORE rotation, from the pair that was still active) — this is what
  // lets the Verifier below give a real "Matches" result inside this same
  // phase, without waiting on bet-history wiring (10-09).
  const [revealed, setRevealed] = React.useState<{
    serverSeed: string
    serverSeedHash: string
    clientSeed: string
  } | null>(null)

  function openRotateConfirm() {
    // Prefilled suggestion the user can accept in one tap; still required and
    // editable — the new client seed being chosen AFTER the new hash is
    // published is a security property (removes the server's freedom to
    // grind a seed pair whose both halves it already knows), not UX polish.
    setRotateClientSeed(newServerSeed().slice(0, 10))
    setRotateError(null)
    setRotating(true)
  }

  function handleSaveClientSeed() {
    if (clientSeedDraft === null) return
    const error = validateClientSeed(clientSeedDraft)
    if (error) {
      setClientSeedError(error)
      return
    }
    setClientSeed.mutate(
      { clientSeed: clientSeedDraft },
      {
        onSuccess: () => {
          setClientSeedDraft(null)
          void qc.invalidateQueries(trpc.casino.getSeed.queryFilter())
        },
        onError: (e) => setClientSeedError(e.message),
      },
    )
  }

  function handleRotate() {
    const error = validateClientSeed(rotateClientSeed)
    if (error) {
      setRotateError(error)
      return
    }
    if (!seedQ.data) return
    const retiredHash = seedQ.data.serverSeedHash
    const retiredClientSeed = seedQ.data.clientSeed
    rotateSeed.mutate(
      { clientSeed: rotateClientSeed },
      {
        onSuccess: (data) => {
          setRevealed({
            serverSeed: data.revealedServerSeed,
            serverSeedHash: retiredHash,
            clientSeed: retiredClientSeed,
          })
          setRotating(false)
          void qc.invalidateQueries(trpc.casino.getSeed.queryFilter())
        },
        onError: (e) => setRotateError(e.message),
      },
    )
  }

  const detailsRef = React.useRef<HTMLDetailsElement>(null)
  const verifierRef = React.useRef<HTMLDivElement>(null)

  // A history-row tap opens this panel and scrolls the Verifier into view — the primary
  // path per 10-UI-SPEC.md § 5. Runs whenever the parent hands down a new selection object.
  React.useEffect(() => {
    if (!historyPrefill) return
    if (detailsRef.current) detailsRef.current.open = true
    verifierRef.current?.scrollIntoView({ behavior: "smooth", block: "start" })
  }, [historyPrefill])

  const effectivePrefill =
    historyPrefill ??
    (revealed
      ? {
          serverSeed: revealed.serverSeed,
          clientSeed: revealed.clientSeed,
          nonce: 0,
          game: CASINO_GAMES[0].slug,
          recordedHash: revealed.serverSeedHash,
          // No bet behind the rotation-reveal example — the Verifier renders the
          // hash comparison and simply omits the per-game derive line.
          config: null,
          recordedMultiplier: null,
        }
      : undefined)

  return (
    <details ref={detailsRef} className="group">
      <summary className="flex min-h-11 cursor-pointer list-none items-center gap-1.5 text-sm font-semibold [&::-webkit-details-marker]:hidden">
        <ShieldCheck className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
        Provably fair
        <ChevronDown
          className="ml-auto h-4 w-4 shrink-0 text-muted-foreground transition-transform duration-200 group-open:rotate-180"
          aria-hidden="true"
        />
      </summary>

      <div className="mt-2 flex flex-col gap-4">
        <div className={cn(panelShell, "flex flex-col gap-4")}>
          {seedQ.isLoading && <p className="text-sm text-muted-foreground">Loading…</p>}
          {seedQ.isError && <p className="text-sm text-destructive">Couldn&apos;t load your seed pair.</p>}

          {seedQ.data && (
            <>
              {/* Server seed hash — first-8 · ellipsis · last-6, tap to expand full. */}
              <div>
                <p className="text-sm text-muted-foreground">Server seed hash</p>
                <div className="mt-1 flex items-start gap-2">
                  <button
                    type="button"
                    aria-expanded={hashExpanded}
                    onClick={() => setHashExpanded((v) => !v)}
                    className="min-h-11 flex-1 rounded-md text-left font-mono text-sm break-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                  >
                    {hashExpanded ? seedQ.data.serverSeedHash : truncateHash(seedQ.data.serverSeedHash)}
                  </button>
                  <CopyButton text={seedQ.data.serverSeedHash} label="Hash" />
                </div>
              </div>

              {/* Client seed editor. */}
              <div>
                <Label htmlFor="fairness-client-seed" className="text-sm text-muted-foreground">
                  Client seed
                </Label>
                <div className="mt-1 flex gap-2">
                  <Input
                    id="fairness-client-seed"
                    value={clientSeedDraft ?? seedQ.data.clientSeed}
                    onChange={(e) => {
                      setClientSeedDraft(e.target.value)
                      setClientSeedError(null)
                    }}
                    maxLength={64}
                    className="h-11 font-mono text-sm"
                  />
                  <Button
                    type="button"
                    variant="outline"
                    className="h-11 shrink-0"
                    disabled={
                      clientSeedDraft === null ||
                      clientSeedDraft === seedQ.data.clientSeed ||
                      setClientSeed.isPending
                    }
                    onClick={handleSaveClientSeed}
                  >
                    Save
                  </Button>
                </div>
                <p className={cn("h-5 text-sm", clientSeedError ? "text-destructive" : "text-muted-foreground")}>
                  {clientSeedError ?? "Letters, numbers and symbols — no colons."}
                </p>
              </div>

              {/* Nonce — snaps on change, no tween; honest first-run state at 0. */}
              <div>
                <div className="flex items-baseline justify-between">
                  <span className="text-sm text-muted-foreground">Bets on this seed</span>
                  <span className="font-mono text-sm tabular-nums">{seedQ.data.nonce}</span>
                </div>
                {seedQ.data.nonce === 0 && (
                  <p className="mt-0.5 text-sm text-muted-foreground">No bets on this seed pair yet.</p>
                )}
              </div>

              {/* Rotate — the one action with a consequence. Two-step, inline,
                  no nested modal (a modal-inside-a-modal is banned here). */}
              {!rotating ? (
                <Button type="button" variant="outline" className="min-h-11 w-full" onClick={openRotateConfirm}>
                  Rotate seed pair
                </Button>
              ) : (
                <div className="flex flex-col gap-3 rounded-lg border p-3">
                  <div>
                    <p className="text-sm font-semibold">Rotate your seed pair?</p>
                    <p className="mt-1 text-sm text-pretty text-muted-foreground">
                      Your current server seed is revealed, so every bet you&apos;ve already made becomes
                      verifiable. The retired pair can&apos;t be used again, and the bet counter resets to 0.
                    </p>
                  </div>
                  <div>
                    <Label htmlFor="rotate-client-seed" className="text-sm text-muted-foreground">
                      New client seed
                    </Label>
                    <Input
                      id="rotate-client-seed"
                      required
                      value={rotateClientSeed}
                      onChange={(e) => {
                        setRotateClientSeed(e.target.value)
                        setRotateError(null)
                      }}
                      maxLength={64}
                      className="mt-1 h-11 font-mono text-sm"
                    />
                    <p className={cn("h-5 text-sm", rotateError ? "text-destructive" : "text-muted-foreground")}>
                      {rotateError ?? ""}
                    </p>
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <Button
                      type="button"
                      variant="outline"
                      className="min-h-11"
                      onClick={() => setRotating(false)}
                    >
                      Cancel
                    </Button>
                    {/* variant="default" (crimson), NOT destructive — nothing is
                        lost and no ZP moves; the consequence is disclosed in
                        prose above, which is where amber's reservation excludes
                        this button. */}
                    <Button
                      type="button"
                      variant="default"
                      className="min-h-11"
                      disabled={rotateSeed.isPending || !rotateClientSeed}
                      onClick={handleRotate}
                    >
                      Rotate & reveal
                    </Button>
                  </div>
                </div>
              )}

              {revealed && (
                <div className="rounded-lg border p-3">
                  <p className="text-sm font-semibold">Revealed — you can verify every bet from this pair</p>
                  <div className="mt-2 flex items-start gap-2">
                    <p className="min-h-11 flex-1 font-mono text-sm break-all">{revealed.serverSeed}</p>
                    <CopyButton text={revealed.serverSeed} label="Revealed server seed" />
                  </div>
                </div>
              )}
            </>
          )}
        </div>

        {/* A tapped history row (historyPrefill) wins over the rotation-reveal example
            below — real bet data is always more useful than the pair this panel just
            retired, which exists so "Matches" is reachable without waiting on history. */}
        <div ref={verifierRef}>
          <Verifier
            key={
              effectivePrefill
                ? `${effectivePrefill.game}-${effectivePrefill.nonce}-${effectivePrefill.serverSeed ?? "unrevealed"}`
                : "empty"
            }
            prefill={
              effectivePrefill
                ? {
                    // A row whose seed pair hasn't rotated yet has no serverSeed/hash —
                    // prefill what IS available and let the Verifier show its own honest
                    // "cannot verify yet" state rather than this panel hiding the tap.
                    serverSeed: effectivePrefill.serverSeed ?? "",
                    clientSeed: effectivePrefill.clientSeed,
                    nonce: effectivePrefill.nonce,
                    game: effectivePrefill.game,
                    recordedHash: effectivePrefill.recordedHash ?? undefined,
                    config: effectivePrefill.config,
                    recordedMultiplier: effectivePrefill.recordedMultiplier,
                  }
                : undefined
            }
          />
        </div>
      </div>
    </details>
  )
}
