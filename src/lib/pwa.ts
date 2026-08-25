// PWA client-side helpers: iOS/standalone detection + VAPID key conversion.
// Source: Next.js official PWA guide (07-RESEARCH.md Pattern 2 + Pattern 4).
// All exports are SSR-safe (guard on `typeof window === "undefined"`) so this
// module can be imported from server components without crashing.

export function isIOS(): boolean {
  if (typeof window === "undefined") return false
  return (
    /iPad|iPhone|iPod/.test(navigator.userAgent) &&
    !(window as unknown as { MSStream?: unknown }).MSStream
  )
}

export function isStandalone(): boolean {
  if (typeof window === "undefined") return false
  return (
    window.matchMedia("(display-mode: standalone)").matches ||
    (navigator as unknown as { standalone?: boolean }).standalone === true
  )
}

// base64url (VAPID public key format) -> Uint8Array (applicationServerKey shape
// pushManager.subscribe expects). Browser-only (uses window.atob).
export function urlBase64ToUint8Array(base64String: string): Uint8Array<ArrayBuffer> {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4)
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/")
  const rawData = window.atob(base64)
  const outputArray = new Uint8Array(rawData.length)
  for (let i = 0; i < rawData.length; ++i) outputArray[i] = rawData.charCodeAt(i)
  return outputArray
}
