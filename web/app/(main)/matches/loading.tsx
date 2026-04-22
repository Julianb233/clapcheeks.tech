export default function Loading() {
  return (
    <div className="min-h-screen bg-black text-white p-4 md:p-8 animate-pulse">
      <div className="max-w-6xl mx-auto">
        <div className="flex items-center justify-between mb-8">
          <div className="space-y-2">
            <div className="h-8 w-56 rounded-md bg-white/10" />
            <div className="h-3 w-80 rounded-md bg-white/5" />
          </div>
          <div className="h-9 w-32 rounded-lg bg-white/10" />
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
          {Array.from({ length: 6 }).map((_, i) => (
            <div
              key={i}
              className="rounded-2xl border border-white/10 bg-white/5 overflow-hidden"
            >
              <div className="aspect-[4/5] bg-white/5" />
              <div className="p-4 space-y-2">
                <div className="h-3 w-full rounded bg-white/10" />
                <div className="h-3 w-5/6 rounded bg-white/10" />
                <div className="h-3 w-3/4 rounded bg-white/5" />
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
