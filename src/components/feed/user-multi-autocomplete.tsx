"use client"

import { useState, useEffect, useRef } from "react"
import { createPortal } from "react-dom"
import { useDebounce } from "use-debounce"
import { useQuery } from "@tanstack/react-query"
import { X, Users } from "lucide-react"
import { useTRPC } from "@/trpc/client"
import { Input } from "@/components/ui/input"
import { navButtonClass } from "@/components/nav/nav-item"
import { cn } from "@/lib/utils"

type SelectedUser = { id: string; name: string | null; username: string | null }

/**
 * Multi-select user picker (M-01). Selected users render as removable chips above
 * the search input; the bound value is the ordered list of selected user ids.
 *
 * Mirrors UserAutocomplete's portal/positioning behavior so it works inside the
 * create-post Dialog (which sets pointer-events:none on body) and the e2e flow
 * (type into "Search users…", click an option) still selects a target.
 */
export function UserMultiAutocomplete({
  value,
  onChange,
  onOpenPicker,
}: {
  value: string[]
  onChange: (userIds: string[]) => void
  onOpenPicker?: () => void
}) {
  const trpc = useTRPC()
  const [query, setQuery] = useState("")
  const [open, setOpen] = useState(false)
  const [debouncedQuery] = useDebounce(query, 250)
  const [selected, setSelected] = useState<SelectedUser[]>([])
  const wrapperRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const dropdownRef = useRef<HTMLDivElement>(null)
  const [dropdownRect, setDropdownRect] = useState<{ top: number; left: number; width: number } | null>(null)

  const { data: results, isLoading } = useQuery({
    ...trpc.post.searchUsers.queryOptions({ query: debouncedQuery }),
    enabled: debouncedQuery.length >= 1,
  })

  // Chips must resolve names for ids added via either the search dropdown (captured
  // in `selected`) or the picker grid (only known to us as a bare id) — fall back to
  // getAll (deduped/cached with the People tab) before falling back to the id itself.
  const { data: allUsers } = useQuery(trpc.user.getAll.queryOptions())
  const allUsersById = new Map((allUsers ?? []).map((u) => [u.id, u]))
  const selectedById = new Map(selected.map((u) => [u.id, u]))
  const displayed: SelectedUser[] = value.map((id) => {
    const fromSearch = selectedById.get(id)
    if (fromSearch) return fromSearch
    const fromAll = allUsersById.get(id)
    if (fromAll) return { id: fromAll.id, name: fromAll.name, username: fromAll.username }
    return { id, name: null, username: null }
  })

  const isDropdownOpen = open && debouncedQuery.length >= 1

  useEffect(() => {
    if (isDropdownOpen && inputRef.current) {
      const rect = inputRef.current.getBoundingClientRect()
      setDropdownRect({ top: rect.bottom + 4, left: rect.left, width: rect.width })
    }
  }, [isDropdownOpen])

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      const target = e.target as Node
      const inWrapper = wrapperRef.current?.contains(target) ?? false
      const inDropdown = dropdownRef.current?.contains(target) ?? false
      if (!inWrapper && !inDropdown) setOpen(false)
    }
    document.addEventListener("mousedown", handleClickOutside)
    return () => document.removeEventListener("mousedown", handleClickOutside)
  }, [])

  function addUser(user: SelectedUser) {
    if (value.includes(user.id)) return
    setSelected((prev) => [...prev, user])
    onChange([...value, user.id])
    setQuery("")
    setOpen(false)
    inputRef.current?.focus()
  }

  function removeUser(id: string) {
    setSelected((prev) => prev.filter((u) => u.id !== id))
    onChange(value.filter((v) => v !== id))
  }

  // Hide already-selected users from the dropdown suggestions.
  const suggestions = (results ?? []).filter((u) => !value.includes(u.id))

  const dropdown =
    isDropdownOpen && dropdownRect
      ? createPortal(
          <div
            ref={dropdownRef}
            id="user-search-listbox"
            role="listbox"
            aria-label="User suggestions"
            style={{
              position: "fixed",
              top: dropdownRect.top,
              left: dropdownRect.left,
              width: dropdownRect.width,
              zIndex: "var(--z-dropdown)",
              pointerEvents: "auto",
            }}
            className="animate-in fade-in-0 zoom-in-95 slide-in-from-top-1 duration-150 ease-[cubic-bezier(0.22,1,0.36,1)] origin-top rounded-md border bg-popover shadow-md"
          >
            {isLoading ? (
              <p role="status" className="p-2 text-sm text-muted-foreground">Searching…</p>
            ) : suggestions.length === 0 ? (
              <p role="status" className="p-2 text-sm text-muted-foreground">No users found.</p>
            ) : (
              suggestions.map((user) => (
                <button
                  key={user.id}
                  type="button"
                  role="option"
                  aria-selected={false}
                  className="flex w-full items-center gap-2 px-3 py-2 text-sm hover:bg-accent transition-colors"
                  onClick={() => addUser(user)}
                >
                  <span>{user.name}</span>
                  {user.username && <span className="text-muted-foreground">@{user.username}</span>}
                </button>
              ))
            )}
          </div>,
          document.body
        )
      : null

  return (
    <div ref={wrapperRef} className="relative">
      {displayed.length > 0 && (
        <ul className="mb-2 flex flex-wrap gap-1.5" aria-label="Selected target users">
          {displayed.map((u) => (
            <li
              key={u.id}
              className="inline-flex items-center gap-1 rounded-full bg-primary/10 px-2.5 py-0.5 text-sm text-primary"
            >
              <span>{u.name ?? u.username ?? u.id}</span>
              <button
                type="button"
                aria-label={`Remove ${u.name ?? u.username ?? u.id}`}
                className="rounded-full p-0.5 transition-colors hover:bg-primary/20"
                onClick={() => removeUser(u.id)}
              >
                <X className="h-3 w-3" aria-hidden="true" />
              </button>
            </li>
          ))}
        </ul>
      )}
      <div className="flex items-center gap-2">
        <Input
          ref={inputRef}
          role="combobox"
          aria-label="Search for users by name"
          aria-expanded={isDropdownOpen}
          aria-autocomplete="list"
          aria-haspopup="listbox"
          aria-controls={isDropdownOpen ? "user-search-listbox" : undefined}
          placeholder="Search users…"
          value={query}
          onChange={(e) => { setQuery(e.target.value); setOpen(true) }}
          onKeyDown={(e) => { if (e.key === "Escape") setOpen(false) }}
          className="flex-1"
        />
        {onOpenPicker && (
          // Same outline the top-bar icon buttons wear — the affordance was invisible
          // as a bare glyph inside the input (and a 32px target, under the 44px floor).
          <button
            type="button"
            aria-label="Browse people"
            title="Browse people"
            onClick={onOpenPicker}
            className={cn(navButtonClass, "shrink-0")}
          >
            <Users className="h-5 w-5" aria-hidden="true" />
          </button>
        )}
      </div>
      {dropdown}
    </div>
  )
}
