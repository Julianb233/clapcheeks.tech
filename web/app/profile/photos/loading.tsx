export default function Loading() {
  return (
    <main className="min-h-screen bg-background text-foreground">
      <div className="max-w-6xl mx-auto px-4 md:px-6 pt-24 pb-16 animate-pulse">
        <div className="mb-8 space-y-3">
          <div className="h-9 w-56 rounded-md bg-muted" />
          <div className="h-4 w-96 max-w-full rounded-md bg-muted" />
        </div>
        <div className="flex gap-3 mb-8">
          <div className="h-9 w-44 rounded-md bg-muted" />
          <div className="h-9 w-44 rounded-md bg-muted" />
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="rounded-xl border border-border p-4 space-y-3">
              <div className="h-4 w-28 rounded bg-muted" />
              <div className="h-10 rounded bg-muted" />
              <div className="grid grid-cols-3 gap-2">
                {Array.from({ length: 3 }).map((_, j) => (
                  <div key={j} className="aspect-square rounded-md bg-muted" />
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
    </main>
  )
}
