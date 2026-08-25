"use client"

// Wordle — the daily 5-letter guessing game.
//
// Fully client-side: the answer is a pure function of the UTC day (words.ts), so
// everyone gets the same word and it rolls at midnight UTC — no server, no DB. Progress
// lives in localStorage keyed by the day, which also makes it naturally once-per-day:
// a finished board reloads finished. ponytail: no ZP award — that needs a server
// mutation (like dailyReward.claim) to be cheat-proof; wire one in if wins should pay.
//
// Motion (globals.css): tiles pop on type, flip to reveal their colour (staggered per
// column), the row shakes on an invalid guess, and the winning row pulses. All collapse
// to an instant colour snap under prefers-reduced-motion.

import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react"
import { useSession } from "next-auth/react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { Grid3x3, Delete } from "lucide-react"
import { useTRPC } from "@/trpc/client"
import { GameCard } from "./game-card"
import { GameDialog } from "./game-dialog"
import { ZpRules } from "./zp-rules"
import { WORD_SET, answerForDay, scoreGuess, type LetterState } from "./words"
import { dayKey } from "@/lib/day-key"
import { WORDLE_ZP_BY_TRIES } from "@/lib/game-economy"
import { cn } from "@/lib/utils"

const ROWS = 6
const COLS = 5
const STORE_KEY = "zigma-wordle"
const FLIP_MS = (COLS - 1) * 230 + 540 // last column's delay + its own duration

type Status = "playing" | "won" | "lost"
type Saved = { day: string; guesses: string[]; status: Status }

// Scored-letter fills. correct/present are the DESIGN semantic tokens; absent is the
// slot machine's game-surface neutral (zinc-700). White glyphs clear ≥3:1 on all three.
const FILL: Record<LetterState, string> = {
  correct: "#059669",
  present: "#d97706",
  absent: "#3f3f46",
}

const WIN_LINES = ["", "Genius", "Magnificent", "Impressive", "Splendid", "Great", "Phew"]

const KEY_ROWS = [
  "qwertyuiop".split(""),
  "asdfghjkl".split(""),
  ["Enter", ..."zxcvbnm".split(""), "Backspace"],
] as const

/** Today's saved progress from localStorage, or a fresh game. Server-safe (returns
 *  a fresh game when there's no window), so it's usable as a useState initializer. */
function loadSaved(day: string): { guesses: string[]; status: Status } {
  const fresh = { guesses: [] as string[], status: "playing" as Status }
  if (typeof window === "undefined") return fresh
  try {
    const raw = localStorage.getItem(STORE_KEY)
    if (!raw) return fresh
    const s = JSON.parse(raw) as Saved
    if (s.day !== day || !Array.isArray(s.guesses)) return fresh
    return {
      guesses: s.guesses.filter((g) => typeof g === "string").slice(0, ROWS),
      status: s.status === "won" || s.status === "lost" ? s.status : "playing",
    }
  } catch {
    return fresh
  }
}

export function Wordle({ index = 0 }: { index?: number }) {
  const [open, setOpen] = useState(false)

  // false on the server and during hydration, true after — gates the card's stored
  // hint/ping so server and first client render agree (no hydration mismatch).
  const isClient = useSyncExternalStore(
    () => () => {},
    () => true,
    () => false,
  )

  // Day + answer resolved once, together, so they can never disagree.
  const [day] = useState(dayKey)
  const [answer] = useState(answerForDay)

  // Lazily restored from localStorage (server-safe) — a finished board reloads finished.
  const [guesses, setGuesses] = useState<string[]>(() => loadSaved(day).guesses)
  const [current, setCurrent] = useState("")
  const [status, setStatus] = useState<Status>(() => loadSaved(day).status)
  const [message, setMessage] = useState("")
  const [animatingRow, setAnimatingRow] = useState<number | null>(null)
  const [winRow, setWinRow] = useState<number | null>(null)
  const [shake, setShake] = useState(false)
  const msgTimer = useRef<number | undefined>(undefined)

  const trpc = useTRPC()
  const qc = useQueryClient()
  const { status: authStatus } = useSession()

  // Server truth for "played today" — authoritative across devices, drives the card.
  const statusQ = useQuery(
    trpc.wordle.getStatus.queryOptions(undefined, {
      enabled: authStatus === "authenticated",
    }),
  )
  const serverPlayed = statusQ.data?.playedToday === true
  const serverResult = statusQ.data?.result ?? null

  // Records the finished game and awards ZP server-side (success handling is on the
  // mutate() call). A CONFLICT (already recorded elsewhere) is fine — the board already
  // shows the word, just no extra ZP.
  const claim = useMutation(trpc.wordle.claim.mutationOptions())

  useEffect(() => () => window.clearTimeout(msgTimer.current), [])

  function flash(text: string, sticky = false) {
    window.clearTimeout(msgTimer.current)
    setMessage(text)
    if (!sticky) msgTimer.current = window.setTimeout(() => setMessage(""), 1200)
  }

  const submitGuess = useCallback(() => {
    if (current.length < COLS) {
      flash("Not enough letters")
      setShake(true)
      return
    }
    if (!WORD_SET.has(current)) {
      flash("Not in word list")
      setShake(true)
      return
    }
    const rowIndex = guesses.length
    const nextGuesses = [...guesses, current]
    const win = current === answer
    const nextStatus: Status = win ? "won" : nextGuesses.length >= ROWS ? "lost" : "playing"

    setGuesses(nextGuesses)
    setCurrent("")
    setAnimatingRow(rowIndex)
    try {
      localStorage.setItem(
        STORE_KEY,
        JSON.stringify({ day, guesses: nextGuesses, status: nextStatus } satisfies Saved),
      )
    } catch {
      /* storage full/blocked → game still playable this session */
    }

    // Let the flip finish before locking the game and announcing the result.
    window.setTimeout(() => {
      setAnimatingRow(null)
      setStatus(nextStatus)
      if (win) setWinRow(rowIndex)
      if (nextStatus !== "playing") {
        // Provisional line now; claim.onSuccess upgrades a win with its ZP once the
        // server responds (fired here, after the reveal, so it can't clobber the reveal).
        flash(
          win ? (WIN_LINES[nextGuesses.length] ?? "Solved!") : `The word was ${answer.toUpperCase()}`,
          true,
        )
        claim.mutate(
          { guesses: nextGuesses },
          {
            onSuccess: (data) => {
              if (data.won) flash(`${WIN_LINES[data.tries] ?? "Solved!"} · +${data.zp} ZP`, true)
              void qc.invalidateQueries(trpc.user.getMe.queryFilter())
              void qc.invalidateQueries(trpc.wordle.getStatus.queryFilter())
            },
          },
        )
      }
    }, FLIP_MS)
  }, [current, guesses, answer, day, claim, qc, trpc])

  // Server truth beats local state: a WordleResult row means this account already
  // finished today's word somewhere. Clearing localStorage (or opening on another
  // device) used to hand back a fresh playable board — the ZP was already safe (the
  // @@unique row rejects a second claim), but the puzzle itself shouldn't replay.
  // One guard on the shared key handler covers BOTH input paths (physical keyboard
  // and the on-screen one), because every keystroke routes through here.
  const lockedOut = serverPlayed && status === "playing"

  const handleKey = useCallback(
    (key: string) => {
      if (status !== "playing" || animatingRow !== null || lockedOut) return
      if (key === "Enter") return submitGuess()
      if (key === "Backspace") return setCurrent((c) => c.slice(0, -1))
      if (/^[a-z]$/.test(key)) setCurrent((c) => (c.length < COLS ? c + key : c))
    },
    [status, animatingRow, lockedOut, submitGuess],
  )

  // Physical keyboard while the modal is open. A ref keeps the listener stable while
  // always calling the latest handler (which closes over current/guesses).
  const keyRef = useRef(handleKey)
  useEffect(() => {
    keyRef.current = handleKey
  })
  useEffect(() => {
    if (!open) return
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return
      if (e.key === "Enter") keyRef.current("Enter")
      else if (e.key === "Backspace") keyRef.current("Backspace")
      else if (/^[a-zA-Z]$/.test(e.key)) keyRef.current(e.key.toLowerCase())
    }
    window.addEventListener("keydown", onKeyDown)
    return () => window.removeEventListener("keydown", onKeyDown)
  }, [open])

  // Best-known state per letter, for colouring the on-screen keyboard.
  const keyStates = useMemo(() => {
    const rank: Record<LetterState, number> = { absent: 0, present: 1, correct: 2 }
    const map: Record<string, LetterState> = {}
    for (const g of guesses) {
      const scored = scoreGuess(g, answer)
      g.split("").forEach((c, i) => {
        const st = scored[i]
        if (!map[c] || rank[st] > rank[map[c]]) map[c] = st
      })
    }
    return map
  }, [guesses, answer])

  const over = status !== "playing"
  const played = over || serverPlayed
  const hint = !isClient
    ? "Daily word game"
    : status === "won"
      ? `Solved in ${guesses.length}`
      : status === "lost"
        ? "Back tomorrow"
        : serverPlayed
          ? serverResult?.won
            ? `Solved in ${serverResult.tries}`
            : "Back tomorrow"
          : guesses.length > 0
            ? "In progress"
            : "New word ready"

  return (
    <>
      <GameCard
        icon={Grid3x3}
        name="Wordle"
        hint={hint}
        available={isClient && !played}
        index={index}
        onClick={() => setOpen(true)}
        ariaLabel="Wordle — guess the daily word"
      />

      <GameDialog
        open={open}
        onOpenChange={setOpen}
        title="Wordle"
        description="Guess the 5-letter word in 6 tries. New word at midnight America/New_York. Solve it fast for more ZP."
      >
        {lockedOut && (
          <div className="rounded-lg bg-muted/40 px-3 py-2.5 text-center">
            <p className="text-sm font-medium">You&rsquo;ve already played today&rsquo;s word.</p>
            <p className="mt-0.5 text-xs text-muted-foreground">
              {serverResult?.won
                ? `Solved in ${serverResult.tries} — +${serverResult.zp} ZP.`
                : "No luck this time."}{" "}
              One word a day, for everyone.
            </p>
          </div>
        )}

        <div className="rounded-2xl bg-zinc-950 p-4 ring-1 ring-border">
          <div className="mx-auto grid max-w-[17rem] gap-1.5">
            {Array.from({ length: ROWS }, (_, r) => {
              const submitted = r < guesses.length
              const word = submitted ? guesses[r] : r === guesses.length ? current : ""
              const scored = submitted ? scoreGuess(guesses[r], answer) : null
              return (
                <div
                  key={r}
                  onAnimationEnd={(e) => {
                    if (e.animationName === "wordle-shake") setShake(false)
                  }}
                  className={cn(
                    "grid grid-cols-5 gap-1.5 [perspective:640px]",
                    r === guesses.length && shake && "animate-wordle-shake",
                  )}
                >
                  {Array.from({ length: COLS }, (_, c) => {
                    const char = word[c] ?? ""
                    const state = scored ? scored[c] : null
                    const bg = state ? FILL[state] : undefined
                    // char in the key remounts the active tile on type → replays the pop.
                    return (
                      <div
                        key={submitted ? `${r}-${c}` : `${r}-${c}-${char}`}
                        style={
                          {
                            "--col": c,
                            ...(bg ? { "--reveal-bg": bg, backgroundColor: bg, borderColor: bg } : {}),
                          } as React.CSSProperties
                        }
                        className={cn(
                          "flex aspect-square items-center justify-center rounded-md border-2 text-2xl font-bold uppercase text-white select-none",
                          !state && "border-white/15",
                          !state && char && "border-white/40",
                          !state && char && "animate-wordle-pop",
                          state && r === animatingRow && "animate-wordle-flip",
                          state && r === winRow && "animate-wordle-win",
                        )}
                      >
                        {char}
                      </div>
                    )
                  })}
                </div>
              )
            })}
          </div>
        </div>

        <p
          aria-live="polite"
          className={cn(
            "min-h-5 text-center text-sm font-medium",
            status === "won" ? "text-emerald-500" : "text-foreground",
          )}
        >
          {message}
          {status === "lost" && !message ? `The word was ${answer.toUpperCase()}` : ""}
        </p>

        {/* On-screen keyboard — the only input path on touch devices, so it sits
            directly under the board, above the ZP explainer. */}
        <div className="flex flex-col gap-1.5" aria-hidden={over || lockedOut}>
          {KEY_ROWS.map((row, ri) => (
            <div key={ri} className="flex justify-center gap-1.5">
              {row.map((key) => {
                const wide = key === "Enter" || key === "Backspace"
                const st = keyStates[key]
                return (
                  <button
                    key={key}
                    type="button"
                    disabled={over || lockedOut}
                    onClick={() => handleKey(key)}
                    aria-label={key === "Backspace" ? "Delete" : key}
                    style={st ? { backgroundColor: FILL[st], color: "#fff" } : undefined}
                    className={cn(
                      "flex h-11 items-center justify-center rounded-md text-sm font-semibold uppercase transition-[transform,background-color] duration-100 ease-out active:scale-95 disabled:opacity-50 motion-reduce:active:scale-100",
                      wide ? "flex-[1.5] px-2 text-xs" : "flex-1",
                      !st && "bg-muted text-foreground hover:bg-muted/70",
                    )}
                  >
                    {key === "Backspace" ? (
                      <Delete className="h-4 w-4" aria-hidden="true" />
                    ) : (
                      key
                    )}
                  </button>
                )
              })}
            </div>
          ))}
        </div>

        {/* Same "How ZP works here" panel every game modal renders. Solve faster,
            earn more — the whole scoring curve, not just "solve it fast". */}
        <ZpRules
          rules={[
            ...WORDLE_ZP_BY_TRIES.map((zp, i) => ({
              what: i === 0 ? "Solved in 1 guess" : `Solved in ${i + 1}`,
              zp: `+${zp} ZP`,
            })),
            { what: "Didn't solve it", zp: "0 ZP" },
          ]}
          replayNote="One word a day, the same word for everyone — no replays, at any price. New word at midnight America/New_York."
        />
      </GameDialog>
    </>
  )
}
