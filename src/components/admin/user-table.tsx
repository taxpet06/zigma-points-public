"use client"

// AdminUserTable — displays all users with their ZP balances.
// ZP Balance cell supports inline editing: click → input, Enter/blur → save, Escape → cancel.
// Pattern: RESEARCH Pattern 4 (controlled input + editingId/editValue state).
//
// Security: admin.updateBalance is FORBIDDEN-guarded server-side (Plan 06-01).
//           Explicit select in /admin page.tsx excludes password (T-6-09 mitigated).
// Accessibility: table role="table", th scope="col", aria-label on inline input (UI-SPEC contract).

import { useState, useRef } from "react"
import { useMutation, useQueryClient } from "@tanstack/react-query"
import { Loader2, Trash2 } from "lucide-react"
import { toast } from "sonner"
import { useSession } from "next-auth/react"
import { useTRPC } from "@/trpc/client"

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface AdminUser {
  id: string
  name: string | null
  email: string | null
  username: string | null
  zigmaPoints: number
  role: "USER" | "ADMIN"
  createdAt: Date
}

interface AdminUserTableProps {
  users: AdminUser[]
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function AdminUserTable({ users }: AdminUserTableProps) {
  const trpc = useTRPC()
  const queryClient = useQueryClient()
  const { data: session } = useSession()
  const currentUserId = session?.user?.id

  // Inline edit state — one row at a time
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editValue, setEditValue] = useState<number>(0)

  // Delete confirmation state
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null)

  // committingRef — tracks whether an explicit save or cancel is in progress.
  // Prevents onBlur from firing a second mutation when Enter or Escape already
  // handled the close (CR-01: Escape saves; CR-02: Enter double-mutates).
  const committingRef = useRef(false)

  // Optimistic local balance overrides — tracks newly-saved values so the
  // button reflects the committed amount while the Server Component is not
  // re-rendered (SSR props are static after first load).
  const [localBalances, setLocalBalances] = useState<Record<string, number>>({})

  const deleteUser = useMutation(
    trpc.admin.deleteUser.mutationOptions({
      onSuccess: () => {
        toast.success("User deleted")
        setConfirmDeleteId(null)
        void queryClient.invalidateQueries(trpc.admin.getAllUsers.queryFilter())
      },
      onError: () => {
        toast.error("Failed to delete user. Try again.")
        setConfirmDeleteId(null)
      },
    })
  )

  const updateBalance = useMutation(
    trpc.admin.updateBalance.mutationOptions({
      onSuccess: (_data, variables) => {
        toast.success("Balance updated")
        setLocalBalances((prev) => ({ ...prev, [variables.userId]: variables.newBalance }))
        void queryClient.invalidateQueries(trpc.admin.getAllUsers.queryFilter())
      },
      onError: () => {
        toast.error("Failed to update balance. Try again.")
        setEditingId(null)
      },
    })
  )

  // Inline edit helpers (Pattern 4)
  function startEdit(userId: string, currentBalance: number) {
    committingRef.current = false
    setEditingId(userId)
    setEditValue(currentBalance)
  }

  function commitEdit(userId: string) {
    committingRef.current = true   // block the subsequent blur from double-mutating (CR-02)
    setEditingId(null)
    updateBalance.mutate({ userId, newBalance: editValue })
  }

  function cancelEdit() {
    committingRef.current = true   // block the subsequent blur from saving (CR-01)
    setEditingId(null)
  }

  return (
    <div className="border rounded-lg overflow-x-auto">
      <table role="table" className="min-w-full text-sm">
        <thead className="bg-muted/50">
          <tr>
            <th scope="col" className="py-3 px-4 text-left text-sm font-semibold">Name</th>
            <th scope="col" className="py-3 px-4 text-left text-sm font-semibold">Email</th>
            <th scope="col" className="py-3 px-4 text-left text-sm font-semibold">Username</th>
            <th scope="col" className="py-3 px-4 text-left text-sm font-semibold">ZP Balance</th>
            <th scope="col" className="py-3 px-4 text-left text-sm font-semibold">Role</th>
            <th scope="col" className="py-3 px-4 text-left text-sm font-semibold">Joined</th>
            <th scope="col" className="py-3 px-4 text-left text-sm font-semibold w-10">
              {/* Delete column */}
            </th>
          </tr>
        </thead>
        <tbody className="divide-y">
          {users.map((user) => (
            <tr key={user.id} className="hover:bg-muted/20 transition-colors">
              {/* Name */}
              <td className="py-3 px-4 font-medium">
                {user.name ?? <span className="text-muted-foreground italic">—</span>}
              </td>

              {/* Email */}
              <td className="py-3 px-4 text-muted-foreground">
                {user.email ?? "—"}
              </td>

              {/* Username */}
              <td className="py-3 px-4 text-muted-foreground">
                {user.username ? `@${user.username}` : <span className="italic">—</span>}
              </td>

              {/* ZP Balance — inline editable cell (D-04) */}
              <td className="py-3 px-4">
                <div className="flex items-center gap-2">
                  {editingId === user.id ? (
                    <>
                      <input
                        type="number"
                        className="w-20 h-8 text-sm border rounded px-2 focus:outline-none focus:ring-2 focus:ring-zinc-400"
                        aria-label={`Edit ZP balance for ${user.name ?? user.email}`}
                        value={editValue}
                        onChange={(e) => setEditValue(Number(e.target.value))}
                        onBlur={() => {
                          if (committingRef.current) {
                            // Enter or Escape already handled; reset the guard and skip
                            committingRef.current = false
                            return
                          }
                          commitEdit(user.id)
                        }}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") { e.preventDefault(); commitEdit(user.id) }
                          if (e.key === "Escape") { e.preventDefault(); cancelEdit() }
                        }}
                        autoFocus
                      />
                      {updateBalance.isPending && (
                        <Loader2 className="h-3 w-3 animate-spin text-muted-foreground" aria-hidden="true" />
                      )}
                    </>
                  ) : (
                    <button
                      type="button"
                      className="tabular-nums font-semibold hover:text-primary focus:outline-none focus:ring-2 focus:ring-zinc-400 rounded px-1 -mx-1"
                      onClick={() => startEdit(user.id, localBalances[user.id] ?? user.zigmaPoints)}
                      title="Click to edit ZP balance"
                    >
                      {localBalances[user.id] ?? user.zigmaPoints}
                    </button>
                  )}
                </div>
              </td>

              {/* Role pill */}
              <td className="py-3 px-4">
                {user.role === "ADMIN" ? (
                  <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium text-primary bg-secondary">
                    Admin
                  </span>
                ) : (
                  <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium text-muted-foreground bg-muted">
                    User
                  </span>
                )}
              </td>

              {/* Joined date */}
              <td className="py-3 px-4 text-muted-foreground text-xs">
                {new Date(user.createdAt).toLocaleDateString("en-US", {
                  year: "numeric",
                  month: "short",
                  day: "numeric",
                })}
              </td>

              {/* Delete */}
              <td className="py-3 px-4">
                {user.id !== currentUserId && (
                  confirmDeleteId === user.id ? (
                    <div className="flex items-center gap-1">
                      <button
                        className="text-xs text-red-600 font-semibold"
                        onClick={() => deleteUser.mutate({ userId: user.id })}
                        disabled={deleteUser.isPending}
                      >
                        {deleteUser.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : "Yes"}
                      </button>
                      <span className="text-xs text-muted-foreground">/</span>
                      <button
                        className="text-xs text-muted-foreground"
                        onClick={() => setConfirmDeleteId(null)}
                        disabled={deleteUser.isPending}
                      >
                        No
                      </button>
                    </div>
                  ) : (
                    <button
                      className="text-muted-foreground hover:text-red-600 transition-colors"
                      onClick={() => setConfirmDeleteId(user.id)}
                      aria-label={`Delete ${user.name ?? user.email}`}
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  )
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
