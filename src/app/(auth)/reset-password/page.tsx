// Reset-password page (AUTH-05). Reads the one-time token from the query string
// (server-side) and hands it to the client form.

import ResetPasswordForm from "./reset-form"

export default async function ResetPasswordPage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string }>
}) {
  const { token } = await searchParams
  return <ResetPasswordForm token={token ?? ""} />
}
