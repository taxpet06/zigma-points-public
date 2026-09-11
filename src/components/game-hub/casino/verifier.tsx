"use client"

// Verifier — the forensic surface (10-UI-SPEC.md § 5). Re-derives the commitment
// and the float stream ENTIRELY on the user's own device, using the identical
// module the server ran (@/lib/casino/fairness). No trpc import, no fetch, no
// server round-trip — that absence is the whole trust argument, not an
// optimisation. No color, no illustration, no animation, no rounded-full
// anything: a user checking whether they were cheated is not in a fun mood.

import * as React from "react"
import { CheckCircle2, Lock, XCircle } from "lucide-react"
import { floats, hashServerSeed } from "@/lib/casino/fairness"
import { CASINO_GAMES } from "@/lib/casino/games"
import { deriveMines } from "@/lib/casino/mines"
import { deriveDice, DICE_MODES, type DiceMode } from "@/lib/casino/dice"
import { derivePlinko, PLINKO_RISKS, type PlinkoRisk } from "@/lib/casino/plinko"
import { deriveWheel, WHEEL_RISKS, type WheelRisk } from "@/lib/casino/wheel"
import { CHICKEN_DIFFICULTIES, CHICKEN_TRAPS, deriveTraps, type ChickenDifficulty } from "@/private-games/chicken/logic"
import { deriveAviamasters } from "@/lib/casino/aviamasters"
import { deriveBlackjackShoe, cardCode } from "@/lib/casino/blackjack"

type CasinoGameSlug = (typeof CASINO_GAMES)[number]["slug"]

// How many floats to recompute and show — enough for the user to feed the
// same (serverSeed, clientSeed, nonce) triple to any third-party Stake-family
// verifier and compare a meaningful run, not just one number.
const PREVIEW_FLOAT_COUNT = 16

/** Narrows a bet's stored `config` JSON to what Plinko's derive needs. Returns null for any
 *  other shape — malformed config, a non-Plinko game's config, or the rotation-reveal
 *  example's `null` — and the caller simply omits the per-game line for that. */
function parsePlinkoConfig(config: unknown): { rows: number; risk: PlinkoRisk } | null {
  if (!config || typeof config !== "object") return null
  const { rows, risk } = config as Record<string, unknown>
  if (typeof rows !== "number" || typeof risk !== "string") return null
  if (!(PLINKO_RISKS as readonly string[]).includes(risk)) return null
  return { rows, risk: risk as PlinkoRisk }
}

/** Narrows a bet's stored `config` JSON to what Mines' derive needs. Same contract as
 *  parsePlinkoConfig: returns null on any other shape (malformed, another game's config, or
 *  the rotation-reveal example's null), so the caller simply omits the per-game line. */
function parseMinesConfig(config: unknown): { mines: number } | null {
  if (!config || typeof config !== "object") return null
  const { mines } = config as Record<string, unknown>
  if (typeof mines !== "number") return null
  return { mines }
}

/** Narrows a bet's stored `config` JSON to what Dice's derive needs. Same contract as
 *  parsePlinkoConfig/parseMinesConfig: returns null on any other shape (malformed, another
 *  game's config, or the rotation-reveal example's null), so the caller simply omits the
 *  per-game line. */
function parseDiceConfig(config: unknown): { targetH: number; mode: DiceMode } | null {
  if (!config || typeof config !== "object") return null
  const { targetH, mode } = config as Record<string, unknown>
  if (typeof targetH !== "number" || typeof mode !== "string") return null
  if (!(DICE_MODES as readonly string[]).includes(mode)) return null
  return { targetH, mode: mode as DiceMode }
}

/** Narrows a bet's stored `config` JSON to what Wheel's derive needs. Same contract as the
 *  three parsers above: returns null on any other shape (malformed, another game's config, or
 *  the rotation-reveal example's null), so the caller simply omits the per-game line. */
function parseWheelConfig(config: unknown): { segments: number; risk: WheelRisk } | null {
  if (!config || typeof config !== "object") return null
  const { segments, risk } = config as Record<string, unknown>
  if (typeof segments !== "number" || typeof risk !== "string") return null
  if (!(WHEEL_RISKS as readonly string[]).includes(risk)) return null
  return { segments, risk: risk as WheelRisk }
}

/** Narrows a bet's stored `config` JSON to what Chicken Cross' derive needs. Same contract as
 *  the four parsers above: returns null on any other shape (malformed, another game's config, or
 *  the rotation-reveal example's null), so the caller simply omits the per-game line. */
function parseChickenConfig(config: unknown): { difficulty: ChickenDifficulty } | null {
  if (!config || typeof config !== "object") return null
  const { difficulty } = config as Record<string, unknown>
  if (typeof difficulty !== "string") return null
  if (!(CHICKEN_DIFFICULTIES as readonly string[]).includes(difficulty)) return null
  return { difficulty: difficulty as ChickenDifficulty }
}

// The per-game re-derivation shown in the match/mismatch result block. `label` and `recorded`
// are pre-formatted (2 decimals — this is a ledger surface) so the render below never has to
// know which game produced them.
type DerivedGameResult = { label: string; recorded: string }

type VerifyResult =
  | { status: "cannot-verify" }
  | { status: "match"; derivedHash: string; derivedFloats: number[]; derived: DerivedGameResult | null }
  | { status: "mismatch"; derivedHash: string; derivedFloats: number[]; derived: DerivedGameResult | null }

export function Verifier({
  prefill,
}: {
  /** Tapping a bet-history row (wired in 10-09) is the primary path into this
   *  form; typing by hand is the fallback. `recordedHash` is the published
   *  serverSeedHash for that seed pair — without it there is nothing to
   *  compare the recomputed hash against, hence "cannot verify yet". */
  prefill?: {
    serverSeed: string
    clientSeed: string
    nonce: number
    game: CasinoGameSlug
    recordedHash?: string
    /** The bet's own stored `{ rows, risk }` (Plinko) or another game's shape (11-12…16
     *  add their own). Absent/malformed/non-Plinko simply omits the per-game line below. */
    config?: unknown
    recordedMultiplier?: number | null
  }
}) {
  const [serverSeed, setServerSeed] = React.useState(prefill?.serverSeed ?? "")
  const [clientSeed, setClientSeed] = React.useState(prefill?.clientSeed ?? "")
  const [nonce, setNonce] = React.useState(String(prefill?.nonce ?? 0))
  const [game, setGame] = React.useState<CasinoGameSlug>(prefill?.game ?? CASINO_GAMES[0].slug)
  const [busy, setBusy] = React.useState(false)
  const [result, setResult] = React.useState<VerifyResult | null>(null)

  const recordedHash = prefill?.recordedHash
  const config = prefill?.config
  const recordedMultiplier = prefill?.recordedMultiplier

  async function handleVerify() {
    if (!recordedHash) {
      setResult({ status: "cannot-verify" })
      return
    }
    setBusy(true)
    try {
      const seed = serverSeed.trim()
      const parsedNonce = Number.parseInt(nonce, 10) || 0
      // The SAME functions the server ran (fairness.ts) — recomputing here,
      // in the browser, with no server call, is the entire point of this
      // component. Never re-implement HMAC/SHA-256 in this file.
      const [derivedHash, derivedFloats] = await Promise.all([
        hashServerSeed(seed),
        floats({ serverSeed: seed, clientSeed: clientSeed.trim(), nonce: parsedNonce }, PREVIEW_FLOAT_COUNT),
      ])

      // ponytail: this is the pattern games 12-16 follow — each adds its own
      // derive(serverSeed, clientSeed, nonce) call here and renders it in this same
      // result block, editing this file directly. No lookup table of derivers, no
      // zero-implementation interface (RESEARCH § Anti-Patterns).
      let derived: DerivedGameResult | null = null
      const plinkoConfig = game === "PLINKO" ? parsePlinkoConfig(config) : null
      if (plinkoConfig && typeof recordedMultiplier === "number") {
        const { bucket, multiplier } = await derivePlinko(
          { serverSeed: seed, clientSeed: clientSeed.trim(), nonce: parsedNonce },
          plinkoConfig.rows,
          plinkoConfig.risk,
        )
        derived = {
          label: `Derived ${multiplier.toFixed(2)}× · bucket ${bucket} of ${plinkoConfig.rows}`,
          recorded: `${recordedMultiplier.toFixed(2)}×`,
        }
      }

      // Mines (12-08) — the mine set IS the fairness claim for this game. Deriving the round's
      // multiplier would additionally require state.revealed, which casino.history does not
      // return, and it's derivable by hand from the positions anyway.
      // ponytail: thread `state` into history when a user asks to re-derive a multiplier, which
      // the positions already let them do by hand.
      const minesConfig = game === "MINES" ? parseMinesConfig(config) : null
      if (minesConfig && typeof recordedMultiplier === "number") {
        const positions = await deriveMines(
          { serverSeed: seed, clientSeed: clientSeed.trim(), nonce: parsedNonce },
          minesConfig.mines,
        )
        derived = {
          label: `Derived mines at ${[...positions].sort((a, b) => a - b).join(", ")}`,
          recorded: `${recordedMultiplier.toFixed(2)}×`,
        }
      }

      // Dice (13-08) — the SAME isomorphic function the server ran, in the browser, with no
      // server call. The derived multiplier here must be the SETTLED one (win ? multiplier : 0),
      // matching what settleBet recorded (mines.ts precedent: a loss settles at 0). Rendering the
      // nominal multiplier against a recorded 0.00x would paint EVERY losing bet as a fairness
      // mismatch — the loudest possible false alarm in the one surface whose job is trust.
      const diceConfig = game === "DICE" ? parseDiceConfig(config) : null
      if (diceConfig && typeof recordedMultiplier === "number") {
        const { roll, win, multiplier } = await deriveDice(
          { serverSeed: seed, clientSeed: clientSeed.trim(), nonce: parsedNonce },
          diceConfig.targetH,
          diceConfig.mode,
        )
        const settled = win ? multiplier : 0
        derived = {
          label: `Derived roll ${roll.toFixed(2)} · ${win ? "win" : "loss"} · ${settled.toFixed(2)}×`,
          recorded: `${recordedMultiplier.toFixed(2)}×`,
        }
      }

      // Wheel (14-04) — the SAME isomorphic function the server ran, in the browser, with no
      // server call. Unlike Dice, there is NO settled-vs-nominal distinction here: a 0x segment
      // IS the table's value, so the derived multiplier always equals what settleBet recorded.
      // Do not "fix" this by adding a win branch.
      const wheelConfig = game === "WHEEL" ? parseWheelConfig(config) : null
      if (wheelConfig && typeof recordedMultiplier === "number") {
        const { index, multiplier } = await deriveWheel(
          { serverSeed: seed, clientSeed: clientSeed.trim(), nonce: parsedNonce },
          wheelConfig.segments,
          wheelConfig.risk,
        )
        derived = {
          label: `Derived segment ${index} of ${wheelConfig.segments} · ${multiplier.toFixed(2)}×`,
          recorded: `${recordedMultiplier.toFixed(2)}×`,
        }
      }

      // Chicken Cross (15-05) — the SAME isomorphic function the server ran, in the browser,
      // with no server call. The trap set IS the fairness claim for this game, exactly as
      // Mines' mine set is (deriveTraps is a plain alias of deriveMines).
      const chickenConfig = game === "CHICKEN" ? parseChickenConfig(config) : null
      if (chickenConfig && typeof recordedMultiplier === "number") {
        const traps = await deriveTraps(
          { serverSeed: seed, clientSeed: clientSeed.trim(), nonce: parsedNonce },
          CHICKEN_TRAPS[chickenConfig.difficulty],
        )
        // Traps are 0-indexed internally; humans count lanes from 1. Sort ascending, then add 1
        // — this is the ONLY boundary where that conversion happens, and it must not be removed
        // without changing the board too. Mines' verifier prints 0-indexed tile numbers; copying
        // that choice here would make this line read "traps at lanes 4, 11, 19" while the board
        // highlighted lanes 5, 12, 20 — a false mismatch in the one surface whose entire job is
        // trust.
        const lanes = [...traps].sort((a, b) => a - b).map((t) => t + 1)
        derived = {
          label: `Derived traps at lanes ${lanes.join(", ")}`,
          recorded: `${recordedMultiplier.toFixed(2)}×`,
        }
      }

      // Avia Masters (16-04) — the SAME isomorphic function the server ran, in the browser,
      // with no server call. The FIRST game needing no parseXConfig helper: config is {}
      // (Aviamasters has no pre-round configuration at all), so the seed triple alone
      // reproduces the round. The derived multiplier here is already the SETTLED one — a water
      // landing derives 0 and settleBet recorded 0 too, so there is no nominal-vs-settled split
      // (the Dice lesson does not apply here). Do not add a win branch, which would paint every
      // water round as a fairness mismatch in the one surface whose entire job is trust.
      if (game === "AVIAMASTERS" && typeof recordedMultiplier === "number") {
        const { steps: aviaSteps, landed, multiplier } = await deriveAviamasters({
          serverSeed: seed,
          clientSeed: clientSeed.trim(),
          nonce: parsedNonce,
        })
        derived = {
          label: `Derived ${landed ? "landed" : "water"} after ${aviaSteps.length} steps · ${multiplier.toFixed(2)}×`,
          recorded: `${recordedMultiplier.toFixed(2)}×`,
        }
      }

      // Blackjack — shoe prefix is the fairness claim (hole + deal order). Multiplier needs
      // the full action path; the first eight codes let a player confirm the initial deal.
      if (game === "BLACKJACK" && typeof recordedMultiplier === "number") {
        const shoe = await deriveBlackjackShoe({
          serverSeed: seed,
          clientSeed: clientSeed.trim(),
          nonce: parsedNonce,
        })
        const deal = shoe.slice(0, 8).map(cardCode).join(" ")
        derived = {
          label: `Derived shoe prefix ${deal}`,
          recorded: `${recordedMultiplier.toFixed(2)}×`,
        }
      }

      setResult(
        derivedHash === recordedHash
          ? { status: "match", derivedHash, derivedFloats, derived }
          : { status: "mismatch", derivedHash, derivedFloats, derived },
      )
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex flex-col gap-3">
      <div>
        <h3 className="text-base font-semibold">Verify a bet</h3>
        {/* This sentence is the whole trust argument — it stays visible, never collapsed. */}
        <p className="text-sm text-muted-foreground">
          Runs entirely on your device — nothing is sent to the server.
        </p>
      </div>

      <div>
        <label htmlFor="verifier-server-seed" className="text-sm text-muted-foreground">
          Server seed
        </label>
        <textarea
          id="verifier-server-seed"
          rows={2}
          value={serverSeed}
          onChange={(e) => setServerSeed(e.target.value)}
          className="mt-1 min-h-11 w-full rounded-md border border-input bg-background px-3 py-2 font-mono text-sm break-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
        />
      </div>

      <div>
        <label htmlFor="verifier-client-seed" className="text-sm text-muted-foreground">
          Client seed
        </label>
        <input
          id="verifier-client-seed"
          type="text"
          value={clientSeed}
          onChange={(e) => setClientSeed(e.target.value)}
          className="mt-1 min-h-11 w-full rounded-md border border-input bg-background px-3 py-2 font-mono text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
        />
      </div>

      <div>
        <label htmlFor="verifier-nonce" className="text-sm text-muted-foreground">
          Nonce
        </label>
        <input
          id="verifier-nonce"
          type="text"
          inputMode="numeric"
          pattern="[0-9]*"
          value={nonce}
          onChange={(e) => setNonce(e.target.value.replace(/[^0-9]/g, ""))}
          className="mt-1 min-h-11 w-full rounded-md border border-input bg-background px-3 py-2 font-mono text-sm tabular-nums focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
        />
      </div>

      <div>
        <label htmlFor="verifier-game" className="text-sm text-muted-foreground">
          Game
        </label>
        {/* Native <select> — a six-option list where the platform picker is
            the correct mobile control. No shadcn select primitive added. */}
        <select
          id="verifier-game"
          value={game}
          onChange={(e) => setGame(e.target.value as CasinoGameSlug)}
          className="mt-1 min-h-11 w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
        >
          {CASINO_GAMES.map((g) => (
            <option key={g.slug} value={g.slug}>
              {g.name}
            </option>
          ))}
        </select>
      </div>

      {/* Deliberately NOT crimson — the crimson button in this dialog means
          "stake ZP"; a second crimson button that spends nothing dilutes
          that meaning. */}
      <button
        type="button"
        disabled={busy}
        onClick={handleVerify}
        className="h-11 w-full rounded-md border border-input bg-background text-sm font-medium hover:bg-accent hover:text-accent-foreground disabled:pointer-events-none disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
      >
        {busy ? "Verifying…" : "Verify"}
      </button>

      {result && (
        <div className="mt-1 rounded-lg border p-4 font-mono text-sm">
          {result.status === "cannot-verify" && (
            <p className="flex items-center gap-1.5 font-semibold text-foreground">
              <Lock className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
              Server seed not revealed yet. Rotate your seed pair to unlock these rounds.
            </p>
          )}

          {result.status === "match" && (
            <>
              <p className="flex items-center gap-1.5 font-semibold">
                <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-600 dark:text-emerald-400" aria-hidden="true" />
                Matches
              </p>
              {/* Never hide the numbers — the recomputed hash and the
                  published hash both shown below, even when they agree. */}
              <p className="mt-2 break-all text-muted-foreground">Derived {result.derivedHash}</p>
              <p className="break-all text-muted-foreground">Recorded {recordedHash}</p>
              {/* The per-game re-derivation (Plinko, 11-07). ponytail: this is the pattern
                  games 12-16 follow — each adds its own derive(...) call in handleVerify
                  and a line here, editing this file directly. No lookup table of
                  derivers, no zero-implementation interface (RESEARCH § Anti-Patterns).
                  Rendered plainly, matching or not — a discrepancy here is never hidden. */}
              {result.derived && (
                <p className="mt-2">
                  {result.derived.label} · recorded {result.derived.recorded}
                </p>
              )}
              <p className="mt-2 break-all">{result.derivedFloats.map((f) => f.toFixed(6)).join(", ")}</p>
            </>
          )}

          {result.status === "mismatch" && (
            <>
              <p className="flex items-center gap-1.5 font-semibold text-destructive">
                <XCircle className="h-4 w-4 shrink-0" aria-hidden="true" />
                {"Doesn't match"}
              </p>
              {/* Both values, side by side, unstyled — never hide the
                  discrepancy behind a friendly message. */}
              <p className="mt-2 break-all">Derived {result.derivedHash}</p>
              <p className="break-all">Recorded {recordedHash}</p>
            </>
          )}
        </div>
      )}
    </div>
  )
}
