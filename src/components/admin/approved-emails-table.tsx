"use client"

// AdminApprovedEmailsTable — manages the signup allowlist (admin.listApprovedEmails).
// Add an email to let that person register; remove one to stop future registrations.
//
// Removing NEVER deletes the account that already registered with the address — the
// "Registered" badge plus the panel's helper text make that visible, since an admin
// would otherwise reasonably expect Remove to revoke access. Deleting an account is
// a separate, deliberate action on the Users tab.
//
// Security: all three procedures are FORBIDDEN-guarded server-side (admin router).

import { useState } from "react"
import { useMutation, useQueryClient } from "@tanstack/react-query"
import { Loader2, Trash2, Plus } from "lucide-react"
import { toast } from "sonner"
import { useTRPC } from "@/trpc/client"
import { Button } from "@/components/ui/button"
import { approvedEmailSchema } from "@/lib/validation/approved-email"

interface ApprovedEmail {
  id: string
  email: string
  createdAt: Date
  registered: boolean
}

export function AdminApprovedEmailsTable({ emails }: { emails: ApprovedEmail[] }) {
  const trpc = useTRPC()
  const queryClient = useQueryClient()

  const [value, setValue] = useState("")
  const [error, setError] = useState<string | null>(null)
  const [confirmRemoveId, setConfirmRemoveId] = useState<string | null>(null)

  const invalidate = () =>
    void queryClient.invalidateQueries(trpc.admin.listApprovedEmails.queryFilter())

  const addEmail = useMutation(
    trpc.admin.addApprovedEmail.mutationOptions({
      onSuccess: () => {
        toast.success("Email approved")
        setValue("")
        setError(null)
        invalidate()
      },
      // Surface the server's message (e.g. already-approved) rather than a generic one.
      onError: (e) => setError(e.message || "Couldn't approve that email. Try again."),
    }),
  )

  const removeEmail = useMutation(
    trpc.admin.removeApprovedEmail.mutationOptions({
      onSuccess: () => {
        toast.success("Email removed from the allowlist")
        invalidate()
      },
      onError: () => toast.error("Couldn't remove that email. Try again."),
    }),
  )

  function submit(e: React.FormEvent) {
    e.preventDefault()
    const parsed = approvedEmailSchema.safeParse({ email: value })
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? "Enter a valid email address")
      return
    }
    setError(null)
    addEmail.mutate({ email: parsed.data.email })
  }

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">
        Only these emails can create an account. Removing one stops future sign-ups from
        that address — it does not delete an account that already exists.
      </p>

      <form onSubmit={submit} className="flex flex-wrap items-start gap-2">
        <div className="min-w-0 flex-1">
          <label htmlFor="approve-email" className="sr-only">
            Email to approve
          </label>
          <input
            id="approve-email"
            type="email"
            inputMode="email"
            autoComplete="off"
            placeholder="name@example.com"
            className="h-10 w-full rounded-md border bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
            value={value}
            onChange={(e) => {
              setValue(e.target.value)
              if (error) setError(null)
            }}
            aria-invalid={error ? true : undefined}
            aria-describedby={error ? "approve-email-error" : undefined}
          />
          {error && (
            <p id="approve-email-error" role="alert" className="mt-1.5 text-sm text-destructive">
              {error}
            </p>
          )}
        </div>
        <Button type="submit" disabled={addEmail.isPending} className="h-10 shrink-0">
          {addEmail.isPending ? (
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
          ) : (
            <Plus className="h-4 w-4" aria-hidden="true" />
          )}
          Approve
        </Button>
      </form>

      {emails.length === 0 ? (
        <p className="py-8 text-center text-sm text-muted-foreground">
          No approved emails — nobody can sign up right now.
        </p>
      ) : (
        <div className="overflow-x-auto rounded-lg border">
          <table role="table" className="min-w-full text-sm">
            <thead className="bg-muted/50">
              <tr>
                <th scope="col" className="px-4 py-3 text-left text-sm font-semibold">Email</th>
                <th scope="col" className="px-4 py-3 text-left text-sm font-semibold">Status</th>
                <th scope="col" className="px-4 py-3 text-left text-sm font-semibold">Added</th>
                <th scope="col" className="w-10 px-4 py-3 text-left text-sm font-semibold">
                  {/* Remove column */}
                </th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {emails.map((row) => (
                <tr key={row.id} className="transition-colors hover:bg-muted/20">
                  <td className="px-4 py-3 font-medium break-all">{row.email}</td>
                  <td className="px-4 py-3">
                    {row.registered ? (
                      <span className="rounded-full bg-muted px-2 py-0.5 text-xs font-medium">
                        Registered
                      </span>
                    ) : (
                      <span className="text-xs text-muted-foreground">Invited</span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-muted-foreground">
                    {new Date(row.createdAt).toLocaleDateString()}
                  </td>
                  <td className="px-4 py-3">
                    {confirmRemoveId === row.id ? (
                      <div className="flex items-center gap-2">
                        <Button
                          size="sm"
                          variant="destructive"
                          disabled={removeEmail.isPending}
                          onClick={() => {
                            setConfirmRemoveId(null)
                            removeEmail.mutate({ id: row.id })
                          }}
                        >
                          Remove
                        </Button>
                        <Button size="sm" variant="ghost" onClick={() => setConfirmRemoveId(null)}>
                          Cancel
                        </Button>
                      </div>
                    ) : (
                      <button
                        type="button"
                        aria-label={`Remove ${row.email} from the allowlist`}
                        className="rounded p-1.5 text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                        onClick={() => setConfirmRemoveId(row.id)}
                      >
                        <Trash2 className="h-4 w-4" aria-hidden="true" />
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
