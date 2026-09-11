// Casino provably-fair HMAC float stream — the ONLY crypto in the casino.
// Source: verified by execution in this session; construction per
// .planning/research/casino/plinko-mines.md §1.4 (mirrors stake.com's implementation page).
//
// Isomorphic on purpose: Node's built-in "crypto" module and Web Crypto were confirmed to
// produce byte-identical output for this construction, so the server derivation and the in-app
// verifier share ONE implementation. A second copy of this function is exactly the bug a
// verifier exists to catch — do NOT "optimise" the server path to the built-in module later.
// Web Crypto (globalThis.crypto.subtle) is available in Node 24.16.0 and every target browser.

export type SeedInput = {
  serverSeed: string
  clientSeed: string
  nonce: number
  cursor?: number
}

const enc = new TextEncoder()

async function hmacBytes(serverSeed: string, msg: string): Promise<Uint8Array> {
  // KEY = serverSeed, MESSAGE = the client-controlled string. These are NOT interchangeable:
  // HMAC(key=clientSeed, msg=serverSeed:...) produces a uniform, plausible, WRONG stream.
  const key = await crypto.subtle.importKey(
    "raw",
    enc.encode(serverSeed),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  )
  return new Uint8Array(await crypto.subtle.sign("HMAC", key, enc.encode(msg)))
}

/**
 * `count` uniform floats in [0,1) from the Stake-family provably-fair stream.
 * Message is `${clientSeed}:${nonce}:${round}` where round = floor(cursor / 32) — the
 * message carries the HMAC round, NOT the raw byte cursor. A widely-mirrored blog post
 * says "cursor", which is only accidentally correct while cursor < 32; using the raw
 * cursor diverges from the correct stream the moment a game needs a second HMAC round
 * (e.g. Plinko's 16 floats, Mines' 24-float shuffle).
 */
export async function floats({ serverSeed, clientSeed, nonce, cursor = 0 }: SeedInput, count: number): Promise<number[]> {
  const bytes: number[] = []
  let round = Math.floor(cursor / 32)
  let offset = cursor - round * 32
  while (bytes.length < count * 4) {
    const buf = await hmacBytes(serverSeed, `${clientSeed}:${nonce}:${round}`)
    for (; offset < 32 && bytes.length < count * 4; offset++) bytes.push(buf[offset])
    offset = 0
    round++
  }
  const out: number[] = []
  for (let i = 0; i < count; i++) {
    let f = 0
    for (let j = 0; j < 4; j++) f += bytes[i * 4 + j] / 256 ** (j + 1)
    out.push(f)
  }
  return out
}

/** Fresh server seed: 32 CSPRNG bytes, hex-encoded. Never a non-cryptographic PRNG — a
 *  predictable server seed defeats the entire commit-reveal guarantee. */
export function newServerSeed(): string {
  return Array.from(crypto.getRandomValues(new Uint8Array(32)))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("")
}

/** SHA-256 of a server seed, hex-encoded — the hash shown pre-bet (FAIR-01). Safe to
 *  publish; the seed itself stays secret until rotation. */
export async function hashServerSeed(seed: string): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", enc.encode(seed)))
  return Array.from(digest)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("")
}
