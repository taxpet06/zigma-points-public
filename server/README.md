# Zigma game server

A single always-on Node process that hosts **many realtime game types at once**. Adding a
game is one file in `games/` plus one line in the registry — never a second server.

It exists because Vercel Hobby functions cap at 10s and cannot hold WebSocket connections,
so anything tick-synced (racing, anything with continuous input) needs its own process.
Turn-based and "keep the feed fresh" cases do **not** need this — polling already covers them.

---

## What's here

| File | What it owns |
|---|---|
| `index.ts` | Connections, ticket auth, rooms, the tick loop, broadcast, disconnects, heartbeat |
| `games/types.ts` | The game-module contract — the only thing a new game has to satisfy |
| `games/tug.ts` | Tug-of-war: the smoke-test game. Trivial on purpose |
| `ticket.ts` | HMAC join tickets + a CLI that prints a shareable join URL |
| `selftest.ts` | `node selftest.ts` — the one runnable check |
| `public/test.html` | Zero-build browser client for testing |

**This server never awards points and never touches the database.** It is a relay. A finished
match gets claimed through a tRPC mutation that re-validates server-side, the same way
`src/trpc/routers/wordle.ts` does. A machine anyone on the internet can reach must not be
able to mint ZP.

Room state lives in memory. Restarting drops matches in progress — accepted trade.

---

## Part 1 — Windows setup, from nothing

### 1. Install Node.js 24 LTS

Open **Terminal** (press `Win`, type "terminal", Enter) and run:

```powershell
winget install OpenJS.NodeJS.LTS
```

Close the terminal and open a **new** one (the PATH change only applies to new windows), then
confirm:

```powershell
node -v
```

You need **v24 or higher**. Node 24 runs `.ts` files directly, which is why there is no build
step here. If `node -v` reports v22, install the current release instead:
`winget install OpenJS.NodeJS`. If `winget` isn't recognised at all, install **App Installer**
from the Microsoft Store, or download the installer from <https://nodejs.org> and accept every
default.

### 1b. Let PowerShell run npm

PowerShell blocks script files by default, and `npm` on Windows *is* a script. If you see
`npm.ps1 cannot be loaded because running scripts is disabled on this system`, run once:

```powershell
Set-ExecutionPolicy -Scope CurrentUser -ExecutionPolicy RemoteSigned
```

Answer `Y`. This affects your user account only, not the machine.

### 2. Install Git and get the code

```powershell
winget install Git.Git
```

Again, open a new terminal, then:

```powershell
cd $HOME
git clone https://github.com/taxpet06/zigma-points.git
cd zigma-points\server
```

The repo is private, so Git Credential Manager (installed alongside Git) opens a browser the
first time — sign in to GitHub and it remembers.

Make sure the branch you cloned actually contains `server/` — if `main` hasn't been pushed
since the server landed, the folder won't be there.

(If you'd rather not clone the whole app, copying just the `server` folder onto the laptop
works — it's self-contained.)

### 3. Install dependencies

```powershell
npm install
```

One real dependency (`ws`). This does **not** install the Next.js app or Prisma.

### 4. Set the shared secret

The server rejects every connection without a secret. Generate one and store it permanently
for your user account:

```powershell
$secret = -join ((1..48) | ForEach-Object { '{0:x}' -f (Get-Random -Max 16) })
[Environment]::SetEnvironmentVariable("GAME_SERVER_SECRET", $secret, "User")
echo $secret
```

Copy that value somewhere safe — the Next app will need the *same* secret later to mint
tickets. Open a **new** terminal so the variable is visible, then verify:

```powershell
echo $env:GAME_SERVER_SECRET
```

### 5. Verify the install before going any further

```powershell
npm test
```

Expected: `selftest: all checks passed`. If this fails, nothing else will work — fix it here
rather than while two people are waiting on a tunnel.

### 6. Run it

```powershell
npm start
```

Expected output: `game server listening on http://localhost:8080  (games: tug)`

Windows Firewall will pop up the first time. **Allow access on private networks** (tick
"Private"). You do not need to allow public networks — the tunnel in Part 3 doesn't need an
inbound port at all.

Leave this window open. `Ctrl+C` stops the server.

---

## Part 2 — Test with two people

### Option A: same wifi (fastest, no internet involved)

1. Find the laptop's local IP:
   ```powershell
   ipconfig
   ```
   Look for **IPv4 Address** under your wifi adapter, e.g. `192.168.1.42`.

2. Mint a join URL for each player:
   ```powershell
   $env:PUBLIC_URL="http://192.168.1.42:8080"
   npm run ticket -- alice lobby1
   npm run ticket -- bob lobby1
   ```
   Each prints a full URL. **`lobby1` is the room name — both players must use the same one.**

3. Send one URL to each person. They open it in any browser on the same wifi.

4. When both have joined, the match starts. Mash **PULL** (or hold spacebar). First to drag
   the rope to their side wins.

### Option B: over the internet (this is the real test)

Cloudflare Tunnel gives you a public HTTPS URL with no account, no port forwarding, and no
router config. It also gives you `wss://` for free — which you **need**, because a page served
over HTTPS is not allowed to open an insecure `ws://` socket.

1. Install it once:
   ```powershell
   winget install Cloudflare.cloudflared
   ```

2. With the server already running in its own terminal, open a **second** terminal and run:
   ```powershell
   cloudflared tunnel --url http://localhost:8080
   ```

3. It prints a URL like `https://random-words-here.trycloudflare.com`. That's your public
   address. It changes every time you restart the tunnel (fine for testing; a named tunnel
   with a fixed hostname needs a free Cloudflare account and a domain).

4. Mint tickets against it, in a **third** terminal:
   ```powershell
   cd $HOME\zigma-points\server
   $env:PUBLIC_URL="https://random-words-here.trycloudflare.com"
   npm run ticket -- alice lobby1
   npm run ticket -- bob lobby1
   ```

5. Send one URL to each person. They can be anywhere.

### What a good test proves

- Both players see `2/2 players` then `go!` → rooms and pairing work
- The rope moves from both sides → concurrent input and broadcast work
- A winner is declared and the room disappears → tick loop and cleanup work
- Mashing faster than 20 times a second gains nothing → the server clamps input, not the client
- Editing the ticket in the URL and reloading gets you closed with code `4001` → auth works

Watch `https://<your-url>/health` for a live room count.

---

## Part 3 — Keeping a Windows 11 laptop up all day

The display turning off is **fine** — that doesn't stop the server. Only *sleep* does. Work
through all five; missing any one of them is how you find the server dead at 3pm.

### 1. Never sleep on AC power

Settings → **System** → **Power & battery** → **Screen and sleep**:
- *When plugged in, turn off my screen after* → whatever you like
- *When plugged in, put my device to sleep after* → **Never**

Or the two-command version:

```powershell
powercfg /change standby-timeout-ac 0
powercfg /change hibernate-timeout-ac 0
```

### 2. Closing the lid must not sleep it

This is a **separate setting** and is the most common cause of a mystery outage.

Control Panel → Hardware and Sound → Power Options → **Choose what closing the lid does** →
set *When I close the lid* → **Plugged in: Do nothing**.

### 3. Stop Windows Update from rebooting you

Settings → **Windows Update** → **Advanced options**:
- **Active hours** → set to cover the whole span you care about
- **Restart as soon as possible…** → **Off**

Updates still install; they just wait for you to reboot. Reboot it deliberately once a week.

### 4. Stop the network adapter from powering down

Device Manager (`Win+X` → Device Manager) → **Network adapters** → your wifi/ethernet adapter →
right-click → **Properties** → **Power Management** tab → **uncheck** *Allow the computer to
turn off this device to save power*.

### 5. Check what your laptop actually supports

```powershell
powercfg /a
```

Most modern laptops use **Modern Standby (S0)** rather than classic sleep, and some will still
doze with the settings above. If yours does, the reliable fix is:

```powershell
powercfg /setacvalueindex SCHEME_CURRENT SUB_SLEEP ALLOWSTANDBY 0
powercfg /setactive SCHEME_CURRENT
```

Then leave it plugged in overnight once and check the server is still logging in the morning
before you trust it with real players.

### Optional: run it as a service so it survives reboots

While testing, a terminal window is fine. Once you want it genuinely always-on:

```powershell
winget install NSSM.NSSM
nssm install ZigmaGameServer "C:\Program Files\nodejs\node.exe" "index.ts"
nssm set ZigmaGameServer AppDirectory "$HOME\zigma-points\server"
nssm set ZigmaGameServer AppEnvironmentExtra "GAME_SERVER_SECRET=<your-secret>"
nssm start ZigmaGameServer
```

It now starts at boot and restarts if it crashes. `nssm stop ZigmaGameServer` /
`nssm remove ZigmaGameServer confirm` to undo.

---

## Adding a game

Write `games/yourgame.ts` exporting a `Game<YourState>` (see `games/types.ts`), then add it to
`GAMES` in `index.ts`. That's the whole integration.

Two things the harness gives you that are easy to miss:

- **`tickRate: 0`** means event-driven. The tick loop skips the room entirely and it advances
  on input alone — turn-based games cost nothing while idle.
- **`snapshot()` is not `state`.** Hidden information (an unrevealed answer, another player's
  hand) stays in state and never ships. Returning state directly is how you leak the answer.

Resist generalising further until game #3 tells you what's actually shared.

---

## Known ceilings

Named on purpose, so they don't surprise you:

- **One process, one core.** A genuinely CPU-heavy game stalls every other room. Nowhere near a
  problem at 20Hz. The fix when it becomes one is sharding rooms across processes with
  `node:cluster`, not a rewrite.
- **Rooms live in one machine's memory.** You cannot add a second server without moving room
  state out.
- **Latency is geography.** Every player's round trip goes to your house. Fine locally, 100ms+
  further out. Any twitch game needs client-side prediction and server reconciliation
  regardless of where it's hosted — the laptop just makes the numbers worse.
- **No persistence.** Restart drops in-flight matches.
- **JSON over the wire.** Readable in DevTools, roughly 3× larger than it needs to be. Only
  worth changing if bandwidth actually bites.

If babysitting a laptop gets old, Cloudflare Durable Objects is the zero-ops version of exactly
this shape — one stateful object per room, WebSocket hibernation, free tier, and it sits near
your players instead of near you. The game modules port across unchanged.
