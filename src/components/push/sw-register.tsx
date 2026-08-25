"use client"
// Registers the root service worker on app load. Two reasons it must happen here
// (app-wide) rather than only inside PushOptIn's "Enable notifications" click:
//   1. Installability — Chrome only builds a real WebAPK ("app", no address bar)
//      when an active service worker is already registered on first visit. Without
//      this, "Add to Home Screen" degrades to a plain bookmark shortcut.
//   2. Push works even if the user never opens the profile-edit opt-in first.
// Idempotent: PushOptIn's own register("/sw.js") call is harmless alongside this.

import { useEffect } from "react"

export function ServiceWorkerRegistrar() {
  useEffect(() => {
    if (!("serviceWorker" in navigator)) return
    // ponytail: fail-soft — a registration failure just means no PWA/push, not a crash.
    navigator.serviceWorker.register("/sw.js").catch(() => {})
  }, [])
  return null
}
