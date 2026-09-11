// Custom not-found page for /u/[username] — renders when username doesn't exist in DB.
// Copy from UI-SPEC Copywriting Contract.

export default function ProfileNotFound() {
  return (
    <main className="max-w-2xl mx-auto px-4 py-16 text-center">
      <h1 className="text-xl font-semibold text-foreground">Profile not found</h1>
      <p className="mt-2 text-base text-muted-foreground">
        This username doesn&apos;t exist or hasn&apos;t been claimed yet.
      </p>
    </main>
  )
}
