// Optional SFX — missing files are silent no-ops (Flappy pattern).

const ASSET_BASE = "/game-hub/casino/blackjack/sounds"
const MUTE_KEY = "zigma-blackjack-muted"

type Slot = HTMLAudioElement | null
const AUDIO: Record<"deal" | "flip" | "chip" | "win" | "lose", Slot> = {
  deal: null,
  flip: null,
  chip: null,
  win: null,
  lose: null,
}

let muted = false
let preloadPromise: Promise<void> | null = null

function loadAudio(src: string): Promise<HTMLAudioElement | null> {
  return new Promise((resolve) => {
    if (typeof window === "undefined") {
      resolve(null)
      return
    }
    const a = new Audio()
    a.preload = "auto"
    a.volume = 0.55
    a.addEventListener("canplaythrough", () => resolve(a), { once: true })
    a.addEventListener("error", () => resolve(null), { once: true })
    a.src = src
    a.load()
  })
}

export function preload(): Promise<void> {
  if (preloadPromise) return preloadPromise
  preloadPromise = (async () => {
    if (typeof window !== "undefined") {
      try {
        muted = window.localStorage.getItem(MUTE_KEY) === "1"
      } catch {
        /* ignore */
      }
    }
    const [deal, flip, chip, win, lose] = await Promise.all([
      loadAudio(`${ASSET_BASE}/deal.mp3`),
      loadAudio(`${ASSET_BASE}/flip.mp3`),
      loadAudio(`${ASSET_BASE}/chip.mp3`),
      loadAudio(`${ASSET_BASE}/win.mp3`),
      loadAudio(`${ASSET_BASE}/lose.mp3`),
    ])
    AUDIO.deal = deal
    AUDIO.flip = flip
    AUDIO.chip = chip
    AUDIO.win = win
    AUDIO.lose = lose
  })()
  return preloadPromise
}

function play(slot: Slot) {
  if (muted || !slot) return
  try {
    slot.currentTime = 0
    void slot.play().catch(() => {})
  } catch {
    /* ignore */
  }
}

export function playDeal() {
  play(AUDIO.deal)
}
export function playFlip() {
  play(AUDIO.flip)
}
export function playChip() {
  play(AUDIO.chip)
}
export function playWin() {
  play(AUDIO.win)
}
export function playLose() {
  play(AUDIO.lose)
}

export function isMuted() {
  return muted
}
export function setMuted(next: boolean) {
  muted = next
  if (typeof window !== "undefined") {
    try {
      window.localStorage.setItem(MUTE_KEY, next ? "1" : "0")
    } catch {
      /* ignore */
    }
  }
}
