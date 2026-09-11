// Atmosphere loader — PNG overlays optional; CSS felt always works (Chicken pattern).

const ASSET_BASE = "/game-hub/casino/blackjack"

type Slot = HTMLImageElement | null

const IMAGES: { felt: Slot; cardBack: Slot; shoe: Slot } = {
  felt: null,
  cardBack: null,
  shoe: null,
}

let preloadPromise: Promise<void> | null = null

function loadImage(src: string): Promise<HTMLImageElement | null> {
  return new Promise((resolve) => {
    if (typeof window === "undefined") {
      resolve(null)
      return
    }
    const img = new Image()
    img.onload = () => resolve(img)
    img.onerror = () => resolve(null)
    img.src = src
  })
}

export function preload(): Promise<void> {
  if (preloadPromise) return preloadPromise
  preloadPromise = (async () => {
    const [felt, cardBack, shoe] = await Promise.all([
      loadImage(`${ASSET_BASE}/felt.jpg`),
      loadImage(`${ASSET_BASE}/card-back.jpg`),
      loadImage(`${ASSET_BASE}/shoe.png`),
    ])
    IMAGES.felt = felt
    IMAGES.cardBack = cardBack
    IMAGES.shoe = shoe
    if (typeof document !== "undefined") {
      const root = document.documentElement
      if (felt) root.style.setProperty("--bj-felt-url", `url(${ASSET_BASE}/felt.jpg)`)
      if (cardBack) root.style.setProperty("--bj-card-back-url", `url(${ASSET_BASE}/card-back.jpg)`)
    }
  })()
  return preloadPromise
}

export function hasFelt(): boolean {
  return IMAGES.felt != null
}
