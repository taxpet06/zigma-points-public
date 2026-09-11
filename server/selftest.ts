// Runnable check for the two pieces that are not obvious: ticket auth and the game
// contract. No framework — `node selftest.ts` and read the exit code.
//
// It is also the fastest way to confirm a fresh Windows install actually works before
// you go anywhere near a tunnel.

import assert from "node:assert/strict"
import { signTicket, verifyTicket } from "./ticket.ts"
import { tug, type TugState } from "./games/tug.ts"

const SECRET = "test-secret-not-used-anywhere-real"
const NOW = 1_700_000_000_000

// --- tickets ---
{
  const t = signTicket("alice", 60_000, NOW, SECRET)
  assert.equal(verifyTicket(t, NOW, SECRET), "alice", "a fresh ticket verifies")

  assert.equal(verifyTicket(t, NOW + 61_000, SECRET), null, "an expired ticket is rejected")
  assert.equal(verifyTicket(t, NOW, "different-secret"), null, "a foreign secret is rejected")
  assert.equal(verifyTicket("", NOW, SECRET), null, "an empty ticket is rejected")
  assert.equal(verifyTicket(t, NOW, ""), null, "no configured secret rejects everything")

  // Swapping the userId while keeping a valid-looking signature must not pass — this is
  // the whole point of signing the payload rather than just the expiry.
  const [, exp, sig] = t.split(".") as [string, string, string]
  assert.equal(verifyTicket(`mallory.${exp}.${sig}`, NOW, SECRET), null, "a swapped userId is rejected")
  assert.equal(verifyTicket(`alice.${NOW + 999_999}.${sig}`, NOW, SECRET), null, "an extended expiry is rejected")

  // Signature comparison must not throw on junk — timingSafeEqual needs equal lengths.
  assert.equal(verifyTicket("alice.123.zz", NOW, SECRET), null, "a malformed signature is rejected")
  assert.throws(() => signTicket("has.dots", 60_000, NOW, SECRET), "a userId containing the delimiter is refused")
}

// --- game contract ---
{
  const state: TugState = tug.init([{ id: "alice" }, { id: "bob" }])
  assert.equal(tug.isOver(state), null, "a fresh match is not over")

  // Only bob pulls: rope moves toward bob (positive).
  tug.onInput(state, "bob", "pull")
  tug.tick!(state, 50)
  assert.ok(state.rope > 0, "an unopposed pull moves the rope")

  // Both pull the same tick: cancels out.
  const before = state.rope
  tug.onInput(state, "alice", "pull")
  tug.onInput(state, "bob", "pull")
  tug.tick!(state, 50)
  assert.equal(state.rope, before, "opposed pulls cancel")

  // Mashing does not beat one pull per tick — the server clamps, not the client.
  for (let i = 0; i < 100; i++) tug.onInput(state, "bob", "pull")
  tug.onInput(state, "alice", "pull")
  tug.tick!(state, 50)
  assert.equal(state.rope, before, "spamming input gains nothing over one pull per tick")

  // Junk input is ignored rather than trusted.
  tug.onInput(state, "bob", { evil: true })
  tug.tick!(state, 50)
  assert.equal(state.rope, before, "unrecognised input is ignored")

  // Run bob to the win line.
  for (let i = 0; i < 100 && !tug.isOver(state); i++) {
    tug.onInput(state, "bob", "pull")
    tug.tick!(state, 50)
  }
  assert.deepEqual(tug.isOver(state), { winnerId: "bob" }, "reaching the line ends the match")

  const snap = tug.snapshot(state) as { rope: number }
  assert.equal(typeof snap.rope, "number", "snapshot is broadcastable")
  assert.ok(!("pending" in (snap as object)), "snapshot omits server-only state")
}

console.log("selftest: all checks passed")
