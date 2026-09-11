import { Suspense } from "react"
import { HomeTabs } from "@/components/feed/home-tabs"

export default async function HomePage() {
  return (
    <div className="max-w-2xl mx-auto px-4 pt-6">
      <Suspense>
        <HomeTabs />
      </Suspense>
    </div>
  )
}
