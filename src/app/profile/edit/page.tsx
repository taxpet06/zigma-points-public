// /profile/edit — server component with owner gate (D-05, T-02-08).
//
// Security:
//   T-02-08 — await auth() server-side; redirect to /sign-in when unauthenticated.
//   The page is always the signed-in user's OWN edit page — no userId param is
//   accepted from the URL, so IDOR is impossible at the routing level.
//   The form (EditProfileForm) never receives a userId — it reads/writes only the
//   session user via getMe / updateProfile.
//
// D-03 / D-10 deviation note (Rule 2):
//   When the nav avatar links to /profile/edit for username-null users, this page
//   is the entry point for the username claim flow. We surface ClaimUsernameForm
//   above the edit form so users can claim a handle before editing other fields.
//   After claiming, ClaimUsernameForm redirects to /u/[username].

import { redirect } from "next/navigation"
import { auth } from "@/auth"
import { db } from "@/lib/db"
import { EditProfileForm } from "./edit-profile-form"
import { AvatarUpload } from "@/components/profile/avatar-upload"
import { ClaimUsernameForm } from "@/components/profile/claim-username-form"
import { PushOptIn } from "@/components/push/push-opt-in"

export default async function EditProfilePage() {
  const session = await auth()

  if (!session?.user?.id) {
    redirect("/sign-in")
  }

  // Check if user has claimed a username — if not, show claim form first
  const user = await db.user.findUnique({
    where: { id: session.user.id },
    select: { username: true },
  })

  const hasUsername = !!user?.username

  return (
    <div className="max-w-lg mx-auto px-4 py-8">
      <h1 className="text-xl font-semibold mb-6">Edit profile</h1>

      {/* D-03 / D-10: Show claim form first when username is null */}
      {!hasUsername && (
        <div className="mb-6">
          <ClaimUsernameForm />
        </div>
      )}

      <div className="mb-6">
        <AvatarUpload />
      </div>

      <EditProfileForm />

      <div className="mt-8 border-t pt-6">
        <h2 className="mb-3 text-sm font-semibold">Notifications</h2>
        <PushOptIn />
      </div>
    </div>
  )
}
