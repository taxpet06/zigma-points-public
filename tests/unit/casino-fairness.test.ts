import { describe, it, expect } from "vitest"
import crypto from "node:crypto"
import { floats, newServerSeed, hashServerSeed } from "@/lib/casino/fairness"

// Golden vector — verified by execution in this session (10-RESEARCH.md § Golden test vector)
// against two independent crypto APIs (node:crypto and Web Crypto). This is the regression
// anchor for the whole fairness primitive: HMAC_SHA256(key=serverSeed, msg=`${clientSeed}:${nonce}:${round}`),
// round = floor(cursor/32), floats from 4-byte groups as b0/256 + b1/256^2 + b2/256^3 + b3/256^4.
const SERVER_SEED = "a".repeat(64)
const CLIENT_SEED = "test"
const NONCE = 1
const SERVER_SEED_HASH = "ffe054fe7ae0cb6dc65c3af9b61d5209f439851db43d0ba5997337df154668eb"
const GOLDEN_FLOATS_10 = [
  0.3141685331, 0.5120243391, 0.4502800240, 0.3783469645, 0.3635938363,
  0.8233012941, 0.7739460992, 0.2343681136, 0.9164775515, 0.7956955419,
]

describe("floats — golden vector", () => {
  it("hashServerSeed matches the published sha256 for the golden server seed", async () => {
    await expect(hashServerSeed(SERVER_SEED)).resolves.toBe(SERVER_SEED_HASH)
  })

  it("the first ten floats match the golden vector to 10 decimal places", async () => {
    const out = await floats({ serverSeed: SERVER_SEED, clientSeed: CLIENT_SEED, nonce: NONCE, cursor: 0 }, 10)
    expect(out).toHaveLength(10)
    for (let i = 0; i < GOLDEN_FLOATS_10.length; i++) {
      expect(out[i]).toBeCloseTo(GOLDEN_FLOATS_10[i], 10)
    }
  })

  it("dice: floor(f0 * 10001) / 100 equals the published roll", async () => {
    const [f0] = await floats({ serverSeed: SERVER_SEED, clientSeed: CLIENT_SEED, nonce: NONCE, cursor: 0 }, 1)
    const dice = Math.floor(f0 * 10001) / 100
    expect(dice).toBeCloseTo(31.41, 10)
  })

  it("plinko: a 16-row bucket sum spans two HMAC rounds and equals 6", async () => {
    // 16 floats = 64 bytes = 2 HMAC rounds of 32 bytes each — this is the whole point of the
    // test: it fails if `floats()` mishandles the round rollover at byte 32.
    const fs = await floats({ serverSeed: SERVER_SEED, clientSeed: CLIENT_SEED, nonce: NONCE, cursor: 0 }, 16)
    const bucket = fs.reduce((sum, f) => sum + Math.floor(f * 2), 0)
    expect(bucket).toBe(6)
  })

  it("mines: a Fisher-Yates shuffle over a 25-tile deck yields first five 19, 5, 2, 13, 17", async () => {
    // Reference derivation (10-RESEARCH.md § 2.5 / plinko-mines.md § 2.5, mirrored from Stake's
    // spec): the deck is the full 25-tile board [0..24]; the shuffle consumes 24 floats
    // (96 bytes -> 3 HMAC rounds); the first m entries of the shuffled deck are the mine
    // positions for a game with m mines. This is the exact derivation the Mines phase inherits.
    const fs = await floats({ serverSeed: SERVER_SEED, clientSeed: CLIENT_SEED, nonce: NONCE, cursor: 0 }, 24)
    const deck = Array.from({ length: 25 }, (_, i) => i)
    for (let i = 24; i > 0; i--) {
      const j = Math.floor(fs[24 - i] * (i + 1))
      ;[deck[i], deck[j]] = [deck[j], deck[i]]
    }
    expect(deck.slice(0, 5)).toEqual([19, 5, 2, 13, 17])
  })
})

describe("floats — key order", () => {
  it("swapping HMAC key and message produces a different stream", async () => {
    const correct = await floats({ serverSeed: SERVER_SEED, clientSeed: CLIENT_SEED, nonce: NONCE, cursor: 0 }, 1)

    // Deliberately wrong: key = clientSeed, message = `${serverSeed}:${nonce}:${round}`.
    const wrongHmac = crypto.createHmac("sha256", CLIENT_SEED)
    wrongHmac.update(`${SERVER_SEED}:${NONCE}:0`)
    const wrongBytes = wrongHmac.digest()
    let wrongF0 = 0
    for (let j = 0; j < 4; j++) wrongF0 += wrongBytes[j] / 256 ** (j + 1)

    expect(wrongF0).not.toBeCloseTo(correct[0], 10)
  })

  it("using the raw cursor instead of floor(cursor/32) as the round diverges from index 8 onward", async () => {
    const correct = await floats({ serverSeed: SERVER_SEED, clientSeed: CLIENT_SEED, nonce: NONCE, cursor: 0 }, 10)

    // Deliberately wrong: treats the raw byte-cursor at the start of each 32-byte block as the
    // round number (0, 32, 64, ...) instead of floor(cursor/32) (0, 1, 2, ...). This is exactly
    // the misdocumented construction flagged in 10-RESEARCH.md (WebSearch result: message is
    // `clientSeed:nonce:cursor`, correct only while cursor < 32).
    const wrongBytes: number[] = []
    let round = 0
    let offset = 0
    while (wrongBytes.length < 40) {
      const h = crypto.createHmac("sha256", SERVER_SEED)
      h.update(`${CLIENT_SEED}:${NONCE}:${round}`)
      const buf = h.digest()
      for (; offset < 32 && wrongBytes.length < 40; offset++) wrongBytes.push(buf[offset])
      offset = 0
      round += 32 // wrong: raw cursor value instead of +1
    }
    const wrong: number[] = []
    for (let i = 0; i < 10; i++) {
      let f = 0
      for (let j = 0; j < 4; j++) f += wrongBytes[i * 4 + j] / 256 ** (j + 1)
      wrong.push(f)
    }

    // Identical for the first HMAC round (round 0 is correct in both constructions)...
    for (let i = 0; i < 8; i++) expect(wrong[i]).toBeCloseTo(correct[i], 10)
    // ...and diverges the moment the second round is needed.
    expect(wrong[8]).not.toBeCloseTo(correct[8], 10)
  })
})

describe("floats — uniform", () => {
  it("100k floats across a range of nonces are uniform in [0,1) with mean near 0.5", async () => {
    const values: number[] = []
    for (let nonce = 1; nonce <= 100; nonce++) {
      const fs = await floats({ serverSeed: SERVER_SEED, clientSeed: CLIENT_SEED, nonce, cursor: 0 }, 1000)
      values.push(...fs)
    }
    expect(values).toHaveLength(100_000)

    // Accumulate and assert once. Calling expect() 300k times inside the loop is what made
    // this test exceed the 5s default timeout — the crypto itself is fast.
    let sum = 0
    let outOfRange = 0
    for (const v of values) {
      if (Number.isNaN(v) || v < 0 || v >= 1) outOfRange++
      sum += v
    }
    expect(outOfRange).toBe(0)
    const mean = sum / values.length
    expect(Math.abs(mean - 0.5)).toBeLessThan(0.01)
  })
})

describe("floats — verify round-trip", () => {
  it("calling floats twice with identical inputs returns identical arrays", async () => {
    const a = await floats({ serverSeed: SERVER_SEED, clientSeed: CLIENT_SEED, nonce: NONCE, cursor: 0 }, 10)
    const b = await floats({ serverSeed: SERVER_SEED, clientSeed: CLIENT_SEED, nonce: NONCE, cursor: 0 }, 10)
    expect(a).toEqual(b)
  })

  it("the cursor addresses a single continuous stream: cursor=32 count=2 overlaps cursor=0 count=10", async () => {
    const ten = await floats({ serverSeed: SERVER_SEED, clientSeed: CLIENT_SEED, nonce: NONCE, cursor: 0 }, 10)
    const fromCursor32 = await floats(
      { serverSeed: SERVER_SEED, clientSeed: CLIENT_SEED, nonce: NONCE, cursor: 32 },
      2,
    )
    // Index 8 of the cursor-0 ten-float call is exactly float 32/4=8 into the stream, i.e. the
    // first float addressed by cursor=32.
    expect(fromCursor32[0]).toBeCloseTo(ten[8], 10)
  })

  it("floats({...}, 1) with cursor 32 equals element index 8 of the cursor-0 ten-float call", async () => {
    const ten = await floats({ serverSeed: SERVER_SEED, clientSeed: CLIENT_SEED, nonce: NONCE, cursor: 0 }, 10)
    const single = await floats({ serverSeed: SERVER_SEED, clientSeed: CLIENT_SEED, nonce: NONCE, cursor: 32 }, 1)
    expect(single[0]).toBeCloseTo(ten[8], 10)
  })
})

// newServerSeed / hashServerSeed shape checks — cheap, pure, and needed by the router tests'
// contract (64 lowercase hex chars each).
describe("newServerSeed and hashServerSeed shape", () => {
  it("newServerSeed returns 64 lowercase hex chars", () => {
    const seed = newServerSeed()
    expect(seed).toMatch(/^[0-9a-f]{64}$/)
  })

  it("hashServerSeed returns 64 lowercase hex chars", async () => {
    const hash = await hashServerSeed(newServerSeed())
    expect(hash).toMatch(/^[0-9a-f]{64}$/)
  })
})
