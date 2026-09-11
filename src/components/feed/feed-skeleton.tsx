import { Card, CardContent, CardFooter, CardHeader } from "@/components/ui/card"

export function FeedSkeleton({ count = 3 }: { count?: number }) {
  return (
    <>
      {Array.from({ length: count }).map((_, i) => (
        <Card key={i} className="animate-pulse">
          <CardHeader className="pb-3">
            {/* type badge + ZP amount + outcome — matches PostCard header row */}
            <div className="flex items-center gap-2">
              <div className="h-5 w-16 rounded-full bg-muted" />
              <div className="h-5 w-10 rounded bg-muted" />
              <div className="ml-auto h-4 w-14 rounded bg-muted" />
            </div>
            {/* author → target */}
            <div className="mt-1 h-4 w-44 rounded bg-muted" />
          </CardHeader>
          <CardContent className="pb-3 space-y-2">
            <div className="h-5 w-3/4 rounded bg-muted" />
            <div className="h-4 w-24 rounded bg-muted" />
          </CardContent>
          <CardFooter className="flex-col gap-2 border-t pt-2">
            {/* vote button placeholders */}
            <div className="flex w-full gap-2">
              <div className="h-11 flex-1 rounded-md bg-muted" />
              <div className="h-11 flex-1 rounded-md bg-muted" />
            </div>
          </CardFooter>
        </Card>
      ))}
    </>
  )
}
