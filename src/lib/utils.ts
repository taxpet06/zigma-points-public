import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

export function formatRelativeTime(date: Date | string | null | undefined): string {
  if (!date) return "—"
  const d = date instanceof Date ? date : new Date(date)
  if (isNaN(d.getTime())) return "—"

  const now = Date.now()
  const diffMs = now - d.getTime()
  const diffSeconds = Math.round(diffMs / 1000)
  const diffMinutes = Math.round(diffSeconds / 60)
  const diffHours = Math.round(diffMinutes / 60)
  const diffDays = Math.round(diffHours / 24)

  const rtf = new Intl.RelativeTimeFormat("en", { numeric: "auto" })

  if (Math.abs(diffSeconds) < 60) return rtf.format(-diffSeconds, "second")
  if (Math.abs(diffMinutes) < 60) return rtf.format(-diffMinutes, "minute")
  if (Math.abs(diffHours) < 24) return rtf.format(-diffHours, "hour")
  if (Math.abs(diffDays) < 30) return rtf.format(-diffDays, "day")
  const diffMonths = Math.round(diffDays / 30)
  if (Math.abs(diffDays) < 365) return rtf.format(-diffMonths, "month")
  return rtf.format(-Math.round(diffDays / 365), "year")
}
