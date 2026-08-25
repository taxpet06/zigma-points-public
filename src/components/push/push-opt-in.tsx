"use client"
// PushOptIn — user-triggered "Enable notifications" control (PUSH-01).
//
// Security:
//   T-07-09 — sends only { endpoint, p256dh, auth } to push.subscribe; ownership
//   is enforced server-side from the session, never from client input.
//
// UI-SPEC:
//   States: checking (reserves layout, no flash) / unsupported / blocked (denied) /
//           enabled (already subscribed) / default (button) / enabling (button, loading)
//   Never calls Notification.requestPermission() outside the onClick handler —
//   auto-prompting on mount is user-hostile and browsers penalize repeated denials.

import { useEffect, useState } from "react"
import { useMutation, useQuery } from "@tanstack/react-query"
import { Bell, BellOff, BellRing, Loader2 } from "lucide-react"
import { toast } from "sonner"
import { useTRPC } from "@/trpc/client"
import { Button } from "@/components/ui/button"
import { urlBase64ToUint8Array } from "@/lib/pwa"

type Support = "checking" | "unsupported" | "supported"

export function PushOptIn() {
  const trpc = useTRPC()
  const subscribe = useMutation(trpc.push.subscribe.mutationOptions())
  const unsubscribe = useMutation(trpc.push.unsubscribe.mutationOptions())

  const [support, setSupport] = useState<Support>("checking")
  const [permission, setPermission] = useState<NotificationPermission | null>(null)
  const [subscribed, setSubscribed] = useState(false)
  const [enabling, setEnabling] = useState(false)
  const [disabling, setDisabling] = useState(false)

  useEffect(() => {
    // Browser feature-detection can only run client-side (window/navigator are
    // unavailable during SSR); deferred to a microtask so the state update
    // happens in a callback rather than synchronously in the effect body
    // (react-hooks/set-state-in-effect) — same hydration-safe intent as the
    // classic `useEffect(() => setMounted(true), [])` gate.
    queueMicrotask(() => {
      const hasApis =
        typeof window !== "undefined" &&
        "serviceWorker" in navigator &&
        "PushManager" in window &&
        "Notification" in window
      const hasVapidKey = !!process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY

      if (!hasApis || !hasVapidKey) {
        setSupport("unsupported")
        return
      }
      setSupport("supported")
      setPermission(Notification.permission)

      // If a subscription already exists (repeat visit, permission previously
      // granted), reflect "enabled" instead of showing the button again.
      navigator.serviceWorker.getRegistration("/").then(async (registration) => {
        const existing = await registration?.pushManager.getSubscription()
        if (existing) setSubscribed(true)
      })
    })
  }, [])

  async function handleEnable() {
    setEnabling(true)
    try {
      const registration = await navigator.serviceWorker.register("/sw.js", {
        scope: "/",
        updateViaCache: "none",
      })
      const result = await Notification.requestPermission()
      setPermission(result)
      if (result !== "granted") return

      const sub = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY!),
      })
      const json = sub.toJSON()
      await subscribe.mutateAsync({
        endpoint: json.endpoint!,
        p256dh: json.keys!.p256dh!,
        auth: json.keys!.auth!,
      })
      setSubscribed(true)
      toast.success("Notifications enabled")
    } catch {
      toast.error("Couldn't enable notifications. Try again.")
    } finally {
      setEnabling(false)
    }
  }

  async function handleDisable() {
    setDisabling(true)
    try {
      const registration = await navigator.serviceWorker.getRegistration("/")
      const sub = await registration?.pushManager.getSubscription()
      if (sub) {
        // Server delete first — a server error must never leave the browser
        // unsubscribed while its row lingers (desync).
        await unsubscribe.mutateAsync({ endpoint: sub.endpoint })
        await sub.unsubscribe()
      }
      setSubscribed(false)
      toast.success("Notifications disabled")
    } catch {
      toast.error("Couldn't disable notifications. Try again.")
    } finally {
      setDisabling(false)
    }
  }

  if (support === "checking") {
    // Reserve the resolved-state footprint (Button default height) to avoid layout shift.
    return <div className="h-11" aria-hidden="true" />
  }

  if (support === "unsupported") {
    return (
      <p className="flex items-center gap-2 text-sm text-muted-foreground">
        <BellOff className="h-4 w-4 shrink-0" aria-hidden="true" />
        Push notifications aren&apos;t supported on this browser.
      </p>
    )
  }

  if (subscribed) {
    return (
      <div className="space-y-3">
        <p className="inline-flex items-center gap-2 rounded-full bg-emerald-500/10 px-3 py-1.5 text-sm font-medium text-emerald-700 dark:text-emerald-400">
          <BellRing className="h-4 w-4 shrink-0" aria-hidden="true" />
          Notifications enabled
        </p>
        <EmailToggle />
        <Button
          type="button"
          variant="outline"
          onClick={handleDisable}
          disabled={disabling}
        >
          {disabling ? (
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
          ) : (
            <BellOff className="h-4 w-4" aria-hidden="true" />
          )}
          {disabling ? "Disabling…" : "Disable notifications"}
        </Button>
      </div>
    )
  }

  if (permission === "denied") {
    return (
      <p className="flex items-center gap-2 text-sm text-muted-foreground">
        <BellOff className="h-4 w-4 shrink-0" aria-hidden="true" />
        Notifications are blocked. Enable them in your browser&apos;s site settings to turn this on.
      </p>
    )
  }

  return (
    <Button type="button" variant="outline" onClick={handleEnable} disabled={enabling}>
      {enabling ? (
        <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
      ) : (
        <Bell className="h-4 w-4" aria-hidden="true" />
      )}
      {enabling ? "Enabling…" : "Enable notifications"}
    </Button>
  )
}

/**
 * Email-notification opt-out — shown only once push is enabled (after PWA install),
 * so users can drop email and keep app notifications only. Optimistic local state,
 * persisted via updateProfile.
 */
function EmailToggle() {
  const trpc = useTRPC()
  const me = useQuery(trpc.user.getMe.queryOptions())
  const update = useMutation(trpc.user.updateProfile.mutationOptions())
  const [emailOn, setEmailOn] = useState<boolean | null>(null)

  const value = emailOn ?? me.data?.emailNotifications ?? true

  async function toggle() {
    const next = !value
    setEmailOn(next)
    try {
      await update.mutateAsync({ emailNotifications: next })
    } catch {
      setEmailOn(!next)
      toast.error("Couldn't update email preference. Try again.")
    }
  }

  return (
    <label className="flex items-center gap-2 text-sm text-muted-foreground">
      <input
        type="checkbox"
        className="h-4 w-4 accent-emerald-600"
        checked={value}
        disabled={me.isLoading || update.isPending}
        onChange={toggle}
      />
      Also email me these notifications
    </label>
  )
}
