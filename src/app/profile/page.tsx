// /profile — stable "my profile" URL. Forwards to the signed-in user's public
// /u/[handle] page. /u accepts a username or an id, so a claimed username is not
// required — id is always available.

import { redirect } from "next/navigation"
import { auth } from "@/auth"

export default async function MyProfilePage() {
  const session = await auth()
  if (!session?.user?.id) redirect("/sign-in")

  redirect(`/u/${session.user.id}`)
}
