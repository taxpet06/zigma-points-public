"use client"

import { useState } from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { toast } from "sonner"
import {
  ArrowUpRight,
  ArrowDownLeft,
  ArrowLeftRight,
  Inbox,
  Loader2,
  Check,
  X,
  HandCoins,
  UserCircle,
} from "lucide-react"
import { useTRPC } from "@/trpc/client"
import { cn } from "@/lib/utils"
import { owedAmount } from "@/lib/validation/transfer"
import { RARITY_META } from "@/lib/cosmetics"
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { Avatar, AvatarFallback } from "@/components/ui/avatar"
import { UserAvatar } from "@/components/cosmetics/user-avatar"
import { CardBackground } from "@/components/cosmetics/card-background"
import { AvatarRing } from "@/components/cosmetics/avatar-ring"
import { CollectiblePickerView } from "@/components/cosmetics/collectible-picker-view"
import { TitleChip } from "@/components/cosmetics/title-chip"
import { UserMultiAutocomplete } from "@/components/feed/user-multi-autocomplete"
import { UserPickerView } from "@/components/feed/user-picker-view"
import { FeedSkeleton } from "@/components/feed/feed-skeleton"

// Minimal slice of shop.getShop's shape — just enough to render a chosen copy's
// preview in TradeForm. Kept local (rather than exported from CollectiblePickerView)
// since it's a read-only projection, same idiom that file uses for its own ShopItem.
type ShopItem = {
  slug: string
  kind: "BACKGROUND" | "RING" | "TITLE"
  name: string
  rarity: "COMMON" | "RARE" | "LEGENDARY"
  circulation: number
  copies: { id: string; mintNumber: number }[]
}

// Module scope on purpose: reading the clock inside a component body (even in a submit
// handler declared there) trips react-hooks/purity.
const isPast = (d: Date) => d.getTime() <= Date.now()

export function TransferPanel() {
  return (
    <Tabs defaultValue="request">
      {/* Standard segmented control — same vocabulary as the profile Sent/Received
          tabs so in-content tabs read the same everywhere. */}
      <TabsList className="mb-5 w-full">
        {/* Five triggers overflow the shared px-3 padding at 360px — the width fix
            (UI-SPEC §2.2) overrides padding on THIS list only, text-sm untouched. */}
        <TabsTrigger value="request" className="flex-1 px-1.5 sm:px-3">Request</TabsTrigger>
        <TabsTrigger value="send" className="flex-1 px-1.5 sm:px-3">Send</TabsTrigger>
        <TabsTrigger value="trade" className="flex-1 px-1.5 sm:px-3">Trade</TabsTrigger>
        <TabsTrigger value="pending" className="flex-1 px-1.5 sm:px-3">Pending</TabsTrigger>
        <TabsTrigger value="loans" className="flex-1 px-1.5 sm:px-3">Loans</TabsTrigger>
      </TabsList>
      <TabsContent value="request" className="mt-0">
        <TransferForm mode="request" />
      </TabsContent>
      <TabsContent value="send" className="mt-0">
        <TransferForm mode="send" />
      </TabsContent>
      <TabsContent value="trade" className="mt-0">
        <TradeForm />
      </TabsContent>
      <TabsContent value="pending" className="mt-0">
        <PendingList />
      </TabsContent>
      <TabsContent value="loans" className="mt-0">
        <LoansList />
      </TabsContent>
    </Tabs>
  )
}

// Request and Send share a form: pick one or more counterparties, an amount, an
// optional note. Same picker + browse-people grid as post targeting (M-01); only the
// direction, copy, and the mutation differ.
function TransferForm({ mode }: { mode: "request" | "send" }) {
  const trpc = useTRPC()
  const { data: me } = useQuery(trpc.user.getMe.queryOptions())

  const [userIds, setUserIds] = useState<string[]>([])
  const [amount, setAmount] = useState("")
  const [note, setNote] = useState("")
  const [view, setView] = useState<"form" | "picker">("form")
  const [isLoan, setIsLoan] = useState(false)
  const [interest, setInterest] = useState("")
  const [due, setDue] = useState("")

  const reset = () => {
    setUserIds([]); setAmount(""); setNote("")
    setIsLoan(false); setInterest(""); setDue("")
  }

  const send = useMutation(
    trpc.transfer.send.mutationOptions({
      onSuccess: () => {
        // No balance invalidation: nothing moves until the recipient approves.
        toast.success("Sent for approval.")
        reset()
      },
      onError: (e) => toast.error(e.message || "Couldn't send ZP."),
    })
  )
  const request = useMutation(
    trpc.transfer.request.mutationOptions({
      onSuccess: () => {
        toast.success(userIds.length > 1 ? "Requests sent." : "Request sent.")
        reset()
      },
      onError: (e) => toast.error(e.message || "Couldn't send request."),
    })
  )

  const isSend = mode === "send"
  const pending = isSend ? send.isPending : request.isPending
  const amt = Number(amount)
  const pct = Number(interest)
  const dueDate = due ? new Date(due) : null
  // The "must be in the future" half of the rule is checked in onSubmit, not here —
  // reading the clock during render trips react-hooks/purity. The schema enforces it
  // server-side either way.
  const loanOk =
    Number.isInteger(pct) && pct >= 0 && pct <= 1000 && interest !== "" &&
    dueDate != null && !Number.isNaN(dueDate.getTime())
  const valid = userIds.length > 0 && Number.isInteger(amt) && amt >= 1 && (!isLoan || loanOk)
  // Send debits amount × recipients — check the total against balance.
  const total = Number.isFinite(amt) ? amt * userIds.length : 0
  const insufficient = isSend && me != null && total > me.zigmaPoints

  function onSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!valid || insufficient) return
    if (isLoan && dueDate != null && isPast(dueDate)) {
      toast.error("Payback date must be in the future.")
      return
    }
    const note_ = note.trim() || undefined
    const loan = isLoan ? { interestPct: pct, dueAt: due } : {}
    if (isSend) send.mutate({ toUserIds: userIds, amount: amt, note: note_, ...loan })
    else request.mutate({ fromUserIds: userIds, amount: amt, note: note_, ...loan })
  }

  if (view === "picker") {
    return (
      <UserPickerView
        value={userIds}
        onConfirm={(ids) => { setUserIds(ids); setView("form") }}
        onBack={() => setView("form")}
      />
    )
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4 animate-card-rise">
      <p className="text-sm text-muted-foreground">
        {isSend
          ? "Offer ZP to other members. They approve or reject it from their Pending tab — it only leaves your balance once they accept."
          : "Ask other members for ZP. They'll approve or reject it from their Pending tab."}
      </p>

      <div className="space-y-1.5">
        <label className="text-sm font-medium">{isSend ? "Recipients" : "Request from"}</label>
        <UserMultiAutocomplete
          value={userIds}
          onChange={setUserIds}
          onOpenPicker={() => setView("picker")}
        />
      </div>

      <div className="space-y-1.5">
        <label htmlFor="transfer-amount" className="text-sm font-medium">
          Amount (ZP){userIds.length > 1 && <span className="font-normal text-muted-foreground"> each</span>}
        </label>
        <Input
          id="transfer-amount"
          type="number"
          min={1}
          inputMode="numeric"
          placeholder="1"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
        />
        {isSend && me != null && (
          <p className={cn("text-xs", insufficient ? "text-destructive" : "text-muted-foreground")}>
            {userIds.length > 1 && valid
              ? <>Total <span className="font-mono font-semibold tabular-nums">{total} ZP</span> · balance </>
              : "Your balance: "}
            <span className="font-mono font-semibold tabular-nums">{me.zigmaPoints} ZP</span>
          </p>
        )}
      </div>

      <div className="space-y-1.5">
        <label htmlFor="transfer-note" className="text-sm font-medium">
          Note <span className="font-normal text-muted-foreground">(optional)</span>
        </label>
        <Textarea
          id="transfer-note"
          rows={2}
          maxLength={160}
          placeholder="What's it for?"
          value={note}
          onChange={(e) => setNote(e.target.value)}
        />
      </div>

      <div className="space-y-3 rounded-lg border p-3">
        <label className="flex items-center gap-2 text-sm font-medium">
          <input
            type="checkbox"
            className="h-4 w-4 accent-emerald-600"
            checked={isLoan}
            onChange={(e) => setIsLoan(e.target.checked)}
          />
          This is a loan
        </label>

        {isLoan && (
          <>
            <div className="space-y-1.5">
              <label htmlFor="loan-interest" className="text-sm font-medium">Interest (%)</label>
              <Input
                id="loan-interest"
                type="number"
                min={0}
                max={1000}
                inputMode="numeric"
                placeholder="10"
                value={interest}
                onChange={(e) => setInterest(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <label htmlFor="loan-due" className="text-sm font-medium">Payback date</label>
              <Input
                id="loan-due"
                type="datetime-local"
                value={due}
                onChange={(e) => setDue(e.target.value)}
              />
            </div>
            {/* Preview uses the same owedAmount() the cron sweep will use, so the number
                shown here is exactly the number that moves. Worded per direction — who
                repays whom is never ambiguous. */}
            {valid && dueDate != null && (
              <p className="text-xs text-muted-foreground">
                {isSend ? "They repay you " : "You repay "}
                <span className="font-mono font-semibold tabular-nums">
                  {owedAmount(amt, pct)} ZP
                </span>
                {isSend && userIds.length > 1 ? " each" : ""}
                {" by "}
                {dueDate.toLocaleString()}.
              </p>
            )}
          </>
        )}
      </div>

      <Button type="submit" className="w-full" disabled={!valid || pending || insufficient}>
        {pending ? (
          <><Loader2 className="mr-2 h-4 w-4 animate-spin" />{isSend ? "Sending…" : "Requesting…"}</>
        ) : isSend ? (
          <><ArrowUpRight className="mr-2 h-4 w-4" />Send ZP</>
        ) : (
          <><ArrowDownLeft className="mr-2 h-4 w-4" />Request ZP</>
        )}
      </Button>
    </form>
  )
}

// Compose a trade offer: one owned copy -> one member -> one ZP price. Same shape
// and rhythm as TransferForm — a "view" union swapping the whole tree for a full-view
// picker, never a Dialog — but with TWO pickers instead of one. The offer is
// compose-only here: the outgoing offer itself surfaces in Pending, not a second
// list on this tab (UI-SPEC §4).
function TradeForm() {
  const trpc = useTRPC()
  const queryClient = useQueryClient()

  const [view, setView] = useState<"form" | "people" | "collectible">("form")
  const [copyId, setCopyId] = useState<string | null>(null)
  const [recipientIds, setRecipientIds] = useState<string[]>([])
  const [price, setPrice] = useState("")

  const reset = () => {
    setCopyId(null); setRecipientIds([]); setPrice("")
  }

  // Read the chosen copy's preview from shop.getShop's cache (react-query dedupes
  // this with CollectiblePickerView's own query) rather than threading extra props
  // out of the picker — the picker only ever returns an id.
  const { data: shopData } = useQuery(trpc.shop.getShop.queryOptions())
  const items = (shopData ?? []) as ShopItem[]
  const chosen = items
    .flatMap((item) => item.copies.map((copy) => ({ item, copy })))
    .find(({ copy }) => copy.id === copyId)

  const tradeOffer = useMutation(
    trpc.transfer.tradeOffer.mutationOptions({
      onSuccess: () => {
        toast.success("Offer sent.")
        reset()
        // The copy just left the sender's free inventory.
        void queryClient.invalidateQueries(trpc.transfer.listPending.queryFilter())
        void queryClient.invalidateQueries(trpc.shop.getShop.queryFilter())
      },
      onError: (e) => toast.error(e.message || "Couldn't send offer."),
    })
  )

  const priceNum = Number(price)
  const valid =
    copyId != null && recipientIds.length === 1 && Number.isInteger(priceNum) && priceNum >= 1
  const pending = tradeOffer.isPending

  function onSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!valid || copyId == null) return
    tradeOffer.mutate({ recipientId: recipientIds[0], cosmeticPurchaseId: copyId, price: priceNum })
  }

  if (view === "collectible") {
    return (
      <CollectiblePickerView
        value={copyId}
        onConfirm={(id) => { setCopyId(id); setView("form") }}
        onBack={() => setView("form")}
      />
    )
  }

  if (view === "people") {
    return (
      <UserPickerView
        value={recipientIds}
        // Constrained to a single recipient — the trade is one copy -> one person —
        // so only the most recently checked id survives, even if the grid itself
        // allowed checking more than one.
        onConfirm={(ids) => { setRecipientIds(ids.slice(-1)); setView("form") }}
        onBack={() => setView("form")}
      />
    )
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4 animate-card-rise">
      <p className="text-sm text-muted-foreground">
        Offer one of your collectibles to another member for a ZP price you set. It leaves
        your inventory while the offer is open, and comes back if they decline or you cancel.
      </p>

      <div className="space-y-1.5">
        <label className="text-sm font-medium">Collectible</label>
        {chosen ? (
          <div className="flex items-center gap-3 rounded-md border p-3">
            <div
              className={cn(
                "relative h-11 w-11 shrink-0 overflow-hidden rounded-md",
                RARITY_META[chosen.item.rarity].glowClass
              )}
            >
              {chosen.item.kind === "BACKGROUND" ? (
                <CardBackground variant={chosen.item.slug} />
              ) : chosen.item.kind === "RING" ? (
                <AvatarRing variant={chosen.item.slug} size={44}>
                  <Avatar className="h-11 w-11">
                    <AvatarFallback>
                      <UserCircle className="h-5 w-5 text-muted-foreground" aria-hidden="true" />
                    </AvatarFallback>
                  </Avatar>
                </AvatarRing>
              ) : (
                <span
                  className="flex h-full w-full items-center justify-center p-1 text-center font-semibold leading-tight"
                  style={{ color: RARITY_META[chosen.item.rarity].hex, fontSize: 10 }}
                >
                  {chosen.item.name}
                </span>
              )}
            </div>
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium">{chosen.item.name}</p>
              <p className="text-xs text-muted-foreground">
                <span style={{ color: RARITY_META[chosen.item.rarity].hex }}>
                  {RARITY_META[chosen.item.rarity].label}
                </span>
                {" · "}
                <span className="font-mono tabular-nums">
                  #{chosen.copy.mintNumber} / {chosen.item.circulation}
                </span>
              </p>
            </div>
            <Button type="button" variant="ghost" size="sm" onClick={() => setView("collectible")}>
              Change
            </Button>
          </div>
        ) : (
          <Button
            type="button"
            variant="outline"
            className="min-h-11 w-full"
            onClick={() => setView("collectible")}
          >
            Choose a collectible
          </Button>
        )}
      </div>

      <div className="space-y-1.5">
        <label className="text-sm font-medium">To</label>
        <UserMultiAutocomplete
          value={recipientIds}
          onChange={(ids) => setRecipientIds(ids.slice(-1))}
          onOpenPicker={() => setView("people")}
        />
      </div>

      <div className="space-y-1.5">
        <label htmlFor="trade-price" className="text-sm font-medium">Price (ZP)</label>
        <Input
          id="trade-price"
          type="number"
          min={1}
          inputMode="numeric"
          placeholder="1"
          value={price}
          onChange={(e) => setPrice(e.target.value)}
        />
        <p className="text-xs text-muted-foreground">They pay you this much if they accept.</p>
      </div>

      <Button type="submit" className="w-full" disabled={!valid || pending}>
        {pending ? (
          <><Loader2 className="mr-2 h-4 w-4 animate-spin" />Sending…</>
        ) : (
          <><ArrowLeftRight className="mr-2 h-4 w-4" />Send offer</>
        )}
      </Button>
    </form>
  )
}

// Every pending obligation the caller is party to, either direction, grouped so
// which side you owe attention on is never ambiguous. Replaces the one-directional
// IncomingRequests: same row shell, same actingId lock, now split into two
// sections (Approve/Reject on your side, today's behaviour; Cancel on theirs) —
// the sentence alone carries the type (request/send/loan/trade), no separate
// type label anywhere (UI-SPEC §6.1). listPending derives iAmPayer/waitingOnMe
// server-side, so the client never re-derives direction — same convention
// listLoans established.
function PendingList() {
  const trpc = useTRPC()
  const queryClient = useQueryClient()
  const { data, isLoading, isError, refetch } = useQuery(trpc.transfer.listPending.queryOptions())
  const [actingId, setActingId] = useState<string | null>(null)

  const invalidateAll = () => {
    // A trade approve/deny/cancel moves or frees a copy, so shop.getShop needs a
    // refresh alongside the usual pending/loans/balance set.
    void queryClient.invalidateQueries(trpc.transfer.listPending.queryFilter())
    void queryClient.invalidateQueries(trpc.transfer.listLoans.queryFilter())
    void queryClient.invalidateQueries(trpc.user.getMe.queryFilter())
    void queryClient.invalidateQueries(trpc.user.getAll.queryFilter())
    void queryClient.invalidateQueries(trpc.shop.getShop.queryFilter())
  }

  const respond = useMutation(
    trpc.transfer.respond.mutationOptions({
      onMutate: ({ transferId }) => setActingId(transferId),
      onSuccess: (_res, { action }) => {
        toast.success(action === "APPROVE" ? "Approved." : "Rejected.")
        invalidateAll()
      },
      onError: (e) => {
        toast.error(e.message || "Couldn't respond.")
        void queryClient.invalidateQueries(trpc.transfer.listPending.queryFilter())
      },
      onSettled: () => setActingId(null),
    })
  )

  const cancel = useMutation(
    trpc.transfer.cancel.mutationOptions({
      onMutate: ({ transferId }) => setActingId(transferId),
      onSuccess: () => {
        toast.success("Cancelled.")
        invalidateAll()
      },
      onError: (e) => {
        toast.error(e.message || "Couldn't cancel.")
        void queryClient.invalidateQueries(trpc.transfer.listPending.queryFilter())
      },
      onSettled: () => setActingId(null),
    })
  )

  if (isLoading) return <FeedSkeleton count={3} />

  if (isError) {
    return (
      <div role="alert" className="py-16 text-center animate-card-rise">
        <p className="mb-3 text-sm font-medium">Couldn&apos;t load pending items.</p>
        <Button variant="link" size="sm" onClick={() => void refetch()}>Try again</Button>
      </div>
    )
  }

  if (!data || data.length === 0) {
    return (
      <div className="py-16 text-center animate-card-rise">
        <Inbox className="mx-auto mb-3 h-8 w-8 text-muted-foreground" />
        <h2 className="mb-2 text-xl font-semibold">Nothing pending.</h2>
        <p className="text-sm text-muted-foreground">
          Requests, transfers, loans and trade offers waiting on either side show up here.
        </p>
      </div>
    )
  }

  // "Waiting on you" always sorts first — the debt of attention is the user's.
  const groups = [
    { title: "Waiting on you", rows: data.filter((t) => t.waitingOnMe) },
    { title: "Waiting on them", rows: data.filter((t) => !t.waitingOnMe) },
  ]

  return (
    <div className="space-y-6">
      {groups.map((group) =>
        group.rows.length === 0 ? null : (
          <div key={group.title} className="space-y-3">
            <h2 className="text-sm font-semibold text-muted-foreground">{group.title}</h2>
            {group.rows.map((t, i) => {
              const initials = ((t.counterparty.name || "?")[0] ?? "?").toUpperCase()
              const name = t.counterparty.name ?? "Someone"
              const busy = actingId === t.id
              const amt = <span className="font-mono font-semibold tabular-nums">{t.amount} ZP</span>
              const who = (
                <>
                  <span className="font-semibold">{name}</span>{" "}
                  <TitleChip slug={t.counterparty.equippedTitle} />
                </>
              )

              // The sentence alone carries the type. Trade rows (item != null)
              // always pair waitingOnMe with iAmPayer (the offerer's direction
              // mapping matches a Request's), so only two combos apply;
              // request/send rows cover all four (UI-SPEC §6.1's table).
              let sentence: React.ReactNode
              if (t.item) {
                sentence = t.waitingOnMe ? (
                  <>{who} wants to sell you {t.item.name} #{t.item.mintNumber} for {amt}</>
                ) : (
                  <>You offered {t.item.name} #{t.item.mintNumber} to {who} for {amt}</>
                )
              } else if (t.waitingOnMe && t.iAmPayer) {
                sentence = <>{who} requested {amt}</>
              } else if (t.waitingOnMe && !t.iAmPayer) {
                sentence = <>{who} wants to send you {amt}</>
              } else if (!t.waitingOnMe && t.iAmPayer) {
                sentence = <>You&apos;re sending {amt} to {who}</>
              } else {
                sentence = <>You requested {amt} from {who}</>
              }

              return (
                <div
                  key={t.id}
                  style={{ "--i": i % 8 } as React.CSSProperties}
                  className="flex items-start gap-3 rounded-lg border bg-card p-4 animate-card-rise"
                >
                  <UserAvatar
                    userId={t.counterparty.id}
                    image={t.counterparty.image}
                    name={t.counterparty.name}
                    ring={t.counterparty.equippedRing}
                    size={40}
                    fallback={<span className="text-sm font-semibold">{initials}</span>}
                  />
                  <div className="min-w-0 flex-1">
                    <p className="text-sm leading-tight">{sentence}</p>
                    {t.item && (
                      <p className="mt-1 text-xs text-muted-foreground font-mono">
                        #{t.item.mintNumber} / {t.item.circulation}
                      </p>
                    )}
                    {t.dueAt && (
                      // Whichever way the ZP flows, the borrower is the receiver. As payer
                      // I'm the lender and get repaid; as receiver I take on the debt — so
                      // the repayment figure is spelled out before either side can accept.
                      <p
                        className={cn(
                          "mt-1 text-xs",
                          t.iAmPayer ? "text-muted-foreground" : "text-destructive",
                        )}
                      >
                        Loan · {t.interestPct ?? 0}% interest ·{" "}
                        {t.iAmPayer ? "they repay you " : "you repay them "}
                        <span className="font-mono font-semibold tabular-nums">
                          {owedAmount(t.amount, t.interestPct ?? 0)} ZP
                        </span>{" "}
                        by {t.dueAt.toLocaleString()}
                      </p>
                    )}
                    {t.note && <p className="mt-1 text-sm text-muted-foreground break-words">{t.note}</p>}
                    {t.waitingOnMe ? (
                      <div className="mt-3 flex gap-2">
                        <Button
                          size="sm"
                          className="flex-1"
                          disabled={busy}
                          onClick={() => respond.mutate({ transferId: t.id, action: "APPROVE" })}
                        >
                          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <><Check className="mr-1 h-4 w-4" />Approve</>}
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          className="flex-1"
                          disabled={busy}
                          onClick={() => respond.mutate({ transferId: t.id, action: "REJECT" })}
                        >
                          <X className="mr-1 h-4 w-4" />Reject
                        </Button>
                      </div>
                    ) : (
                      <div className="mt-3">
                        <Button
                          size="sm"
                          variant="outline"
                          className="w-full"
                          disabled={busy}
                          onClick={() => cancel.mutate({ transferId: t.id })}
                        >
                          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : "Cancel"}
                        </Button>
                      </div>
                    )}
                  </div>
                  {t.item && (
                    <div
                      className={cn(
                        "relative h-12 w-12 shrink-0 overflow-hidden rounded-md",
                        // rarity is technically optional on the server's shape (an
                        // unrecognized slug falls through to undefined) — COMMON is a
                        // safe display fallback, never reachable for a real catalog slug.
                        RARITY_META[t.item.rarity ?? "COMMON"].glowClass
                      )}
                    >
                      {t.item.kind === "BACKGROUND" ? (
                        <CardBackground variant={t.item.slug} />
                      ) : t.item.kind === "RING" ? (
                        <AvatarRing variant={t.item.slug} size={48}>
                          <Avatar className="h-12 w-12">
                            <AvatarFallback>
                              <UserCircle className="h-6 w-6 text-muted-foreground" aria-hidden="true" />
                            </AvatarFallback>
                          </Avatar>
                        </AvatarRing>
                      ) : (
                        <span
                          className="flex h-full w-full items-center justify-center p-1 text-center font-semibold leading-tight"
                          style={{ color: RARITY_META[t.item.rarity ?? "COMMON"].hex, fontSize: 10 }}
                        >
                          {t.item.name}
                        </span>
                      )}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        ),
      )}
    </div>
  )
}

// Live loans on both sides, read-only — there is no repay button and no early-repay path;
// the cron sweep collects automatically at the deadline. The borrower/lender split arrives
// pre-derived as iAmBorrower so the direction rule stays server-side.
function LoansList() {
  const trpc = useTRPC()
  const { data, isLoading, isError, refetch } = useQuery(trpc.transfer.listLoans.queryOptions())

  if (isLoading) return <FeedSkeleton count={3} />

  if (isError) {
    return (
      <div role="alert" className="py-16 text-center animate-card-rise">
        <p className="mb-3 text-sm font-medium">Couldn&apos;t load loans.</p>
        <Button variant="link" size="sm" onClick={() => void refetch()}>Try again</Button>
      </div>
    )
  }

  if (!data || data.length === 0) {
    return (
      <div className="py-16 text-center animate-card-rise">
        <HandCoins className="mx-auto mb-3 h-8 w-8 text-muted-foreground" />
        <h2 className="mb-2 text-xl font-semibold">No open loans.</h2>
        <p className="text-sm text-muted-foreground">
          Tick &ldquo;This is a loan&rdquo; on a request or a send to start one.
        </p>
      </div>
    )
  }

  const owe = data.filter((l) => l.iAmBorrower)
  const owed = data.filter((l) => !l.iAmBorrower)

  return (
    <div className="space-y-6">
      {[
        { title: "You owe", rows: owe },
        { title: "Owed to you", rows: owed },
      ].map((group) =>
        group.rows.length === 0 ? null : (
          <div key={group.title} className="space-y-3">
            <h2 className="text-sm font-semibold text-muted-foreground">{group.title}</h2>
            {group.rows.map((l, i) => {
              const initials = ((l.counterparty.name || "?")[0] ?? "?").toUpperCase()
              return (
                <div
                  key={l.id}
                  style={{ "--i": i % 8 } as React.CSSProperties}
                  className="flex items-start gap-3 rounded-lg border bg-card p-4 animate-card-rise"
                >
                  <UserAvatar
                    userId={l.counterparty.id}
                    image={l.counterparty.image}
                    name={l.counterparty.name}
                    ring={l.counterparty.equippedRing}
                    size={40}
                    fallback={<span className="text-sm font-semibold">{initials}</span>}
                  />
                  <div className="min-w-0 flex-1">
                    <p className="text-sm leading-tight">
                      <span className="font-semibold">{l.counterparty.name ?? "Someone"}</span>
                      <TitleChip slug={l.counterparty.equippedTitle} />
                      {" · "}
                      <span className="font-mono font-semibold tabular-nums">{l.owed} ZP</span>
                    </p>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {l.amount} ZP at {l.interestPct ?? 0}% · due {l.dueAt?.toLocaleString()}
                    </p>
                    {l.note && <p className="mt-1 text-sm text-muted-foreground break-words">{l.note}</p>}
                  </div>
                </div>
              )
            })}
          </div>
        ),
      )}
    </div>
  )
}
